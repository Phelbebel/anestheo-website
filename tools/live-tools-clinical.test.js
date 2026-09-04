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
    /* WAS: "Phase 1..8". "Phase" was development vocabulary that reached the
       product — a clinician does not think in phases of a rebuild. The
       ordinal survives because it still orders the eight workspaces of a
       case; only the word is gone, and its absence is asserted separately. */
    t('the eight workspaces of a case are numbered in order',
      ['induction','maintenance','tiva','analgesia','reversal','fluids','vasopressors','local']
        .map(d => leads[d].num).join(',') ===
      '1 of 8,2 of 8,3 of 8,4 of 8,5 of 8,6 of 8,7 of 8,8 of 8',
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
                  control:!!c && !!c.offsetParent,
                  search:!!(c && c.querySelector('input[type=search]')),
                  buttons:c ? c.querySelectorAll('button').length : 0 };
      setDomain('induction');
      return r;
    })()`);
    t('the drug reference head is never folded away',
      dref.folded === false && dref.headShown === true, dref);
    /* WAS: "...so its Table / Cards control is still on the page". Phase 3
       removed that control on purpose: the table is what a desktop wants, a
       phone cannot set one, and the presentation is decided by the width
       available rather than by a preference. What must still be there is the
       SEARCH, which is the control that slot exists for. */
    t('...so its search control is still on the page',
      dref.control === true && dref.search === true && dref.buttons === 0, dref);

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
       REWRITTEN FOR THE PLAN COCKPIT, NOT WEAKENED. The assertions this
       replaces encoded a PRESENTATION that no longer exists — nine numbered
       sections, a separate "Available agents" catalogue, one selectable card
       class — and could not pass against a UI where the plan is one block
       with a row per clinical role. Every CLAIM they made is re-made below
       against the new markup, and the two that mattered most are stronger
       here than they were:

         nothing is ever selected on the clinician's behalf
         the plan contains exactly what was selected and nothing else

       Nothing protected was dropped. The section-count and empty-state-wording
       assertions are gone because they described the old layout; the
       behaviours they were guarding are asserted directly. */
    console.log('\nINDUCTION WORKSTATION');

    const ind = sel => `[...document.querySelectorAll('#induction-host ${sel}')]`;
    /* Every dose visible anywhere in the workstation, for drift comparison. */
    const doseSnapshot = `(() => {
      const m = {};
      ${ind('.pl-role')}.forEach(r => {
        const n = (r.querySelector('.pl-sel-n') || {}).textContent;
        if (!n) return;
        m[r.dataset.role + ':' + n] =
          ((r.querySelector('.pl-rule')||{}).textContent||'') + '|' +
          ((r.querySelector('.pl-amt')||{}).textContent||'');
      });
      /* The reference is the shared table now, not a card list of its own.
         Same drugs, same canonical rows — read from the row the clinician
         actually sees, which is the point of comparing them at all. */
      ${ind('#iref-body tr.dtab-r')}.forEach(c => {
        m['ref:' + (c.querySelector('.dtab-n')||{}).textContent] =
          (c.querySelector('.dtab-dose')||{}).textContent.replace(/\\s+/g,' ').trim();
      });
      return m;
    })()`;

    const adult = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute();
      const host = document.getElementById('induction-host');
      return { titles: ${ind('.wf-sec .wf-t')}.map(n => n.textContent),
               nums: ${ind('.wf-sec .wf-n')}.map(n => n.textContent),
               roles: ${ind('.pl-sel')}.map(r => r.dataset.role),
               addControls: ${ind('.pl-add')}.length,
               pedsNodes: ${ind('.pdx, .pdx-grid')}.length,
               pedsWords: /EBV|Paediatric context/.test(host.textContent),
               selected: ${ind('.pl-sel')}.length,
               segOn: ${ind('.pl-sg.on')}.length,
               refScrolls: (() => { const r = host.querySelector('.idref');
                 return !!r && getComputedStyle(r).overflowY === 'auto'; })(),
               openLists: ${ind('.pl-alts')}.length,
               noRouteControl: !${ind('.pl-sg')}
                 .some(b => /^(IV|Inhalational)$/i.test(b.textContent.trim())),
               noDevWords: !/phase\s*\d/i.test(document.querySelector('.eng-wrap').innerText),
               geo: (() => {
                 const b = s => { const e = document.querySelector(s);
                   return e ? e.getBoundingClientRect() : null; };
                 const m = b('.wf-col-main'), sd = b('.wf-col-side'), f = b('.wf-full');
                 return m && sd && f ? {
                   mainX:Math.round(m.x), sideX:Math.round(sd.x),
                   mainY:Math.round(m.y), sideY:Math.round(sd.y),
                   refY:Math.round(f.y), refW:Math.round(f.width),
                   refX:Math.round(f.x), mainW:Math.round(m.width),
                   /* THE REFERENCE SPANS THE PAIR. What matters now is that
                      it starts below the TALLER of the two columns and is as
                      wide as both together, not that it hugs the plan. */
                   colsBottom:Math.round(Math.max(m.y + m.height, sd.y + sd.height)),
                   /* The backup airway strip spans the centre between the
                      column pair and the reference, so each block is measured
                      against the one directly above it. */
                   gapUnderCols:(() => {
                     const s2 = document.querySelector('.wf-bkp');
                     const top = s2 ? s2.getBoundingClientRect().y : f.y;
                     return Math.round(top -
                       Math.max(m.y + m.height, sd.y + sd.height)); })(),
                   gapUnderStrip:(() => {
                     const s2 = document.querySelector('.wf-bkp');
                     return s2 ? Math.round(f.y - (s2.getBoundingClientRect().y +
                       s2.getBoundingClientRect().height)) : 0; })(),
                   centreW:Math.round(m.width + sd.width + 12),
                   split:Math.round(100*m.width/(m.width+sd.width)) } : null; })() };
    })()`);
    /* THE PAGE IS THE PLAN. Four sections for an adult, and the first one is
       the thing the screen exists to answer. */
    /* Derived from the geometry above rather than asserted separately. */
    adult.airwayBeside = !!adult.geo && adult.geo.sideX > adult.geo.mainX &&
                         Math.abs(adult.geo.sideY - adult.geo.mainY) < 40;
    /* THE REFERENCE SPANS THE CENTRAL WORKSPACE, UNDER BOTH COLUMNS. It was a
       child of .wf-col-main and inherited the plan column's 488px, which is
       what forced the indication under the drug name, the preparation under
       the dose, and a 78px average row. It is a sibling of the pair now:
       same left edge as the plan, the full width of plan + airway, and
       starting below whichever column is taller. */
    adult.refSpansCentre = !!adult.geo &&
                         adult.geo.refX === adult.geo.mainX &&
                         adult.geo.refW >= adult.geo.centreW - 4 &&
                         adult.geo.refW > adult.geo.mainW * 1.4 &&
                         adult.geo.refY >= adult.geo.colsBottom;
    /* THE WORKSTATION GEOMETRY: the plan and the airway are two halves of one
       decision and sit side by side; the reference spans beneath both. */
    /* DOM order is now column-major: the left column carries the plan and
       the reference beneath it, the right column the airway and its backup. */
    /* DOM ORDER FOLLOWS THE GEOMETRY. The reference was a child of the plan
       column and read between the plan and the airway; it spans the central
       workspace beneath both now, so it comes after both — which is also the
       order it is read in. */
    /* THE ORDINALS ARE DERIVED FROM WHAT IS ON THE SCREEN. Every section used
       to declare its own number — plan 1, airway 2, paediatric 3, reference 4
       — and two of those are conditional, so the numbering described a
       workstation that is not always the one rendered. Once the reference
       moved to the end an adult read 1, 2, then 4 and went looking for a
       section 3 that does not exist for them.

       Asserted as a PROPERTY, not as a string: whatever set of sections a
       patient produces, the numbers on them are 1..N in order with nothing
       missing and nothing repeated. A section that opts out of numbering —
       the backup airway belongs to the airway plan above it — is stepped over
       without consuming one. */
    const contiguous = nums => {
      const seen = nums.filter(x => /^\d+$/.test(x)).map(Number);
      return seen.length > 0 &&
             seen.every((v, i) => v === i + 1);
    };
    t('adult: the visible section ordinals run 1..N with nothing skipped',
      contiguous(adult.nums) && adult.nums.filter(x => /^\d+$/.test(x)).length === 3,
      adult.nums);
    t('adult: plan beside airway, and the reference beneath both',
      adult.titles.join(' / ') ===
      'Induction plan / Airway plan / Backup difficult airway / Drug reference',
      adult.titles);
    t('...the airway column sits BESIDE the plan, not under it',
      adult.airwayBeside === true, adult.geo);
    t('...and the reference spans the whole centre beneath both of them',
      adult.refSpansCentre === true, adult.geo);
    /* NO ANONYMOUS BAND anywhere down the centre: columns, then the backup
       airway strip, then the reference, each directly under the last. */
    t('...with no reserved gap anywhere down the centre stack',
      !!adult.geo && adult.geo.gapUnderCols <= 16 && adult.geo.gapUnderStrip <= 16,
      adult.geo && { underColumns:adult.geo.gapUnderCols,
                     underStrip:adult.geo.gapUnderStrip });
    /* WAS: "one row per canonical clinical role". Three role containers each
       reserving an empty cell for an agent nobody selected was three
       headings and three blank rectangles of monitor for no information. The
       display is flat now and the state is still grouped — which is what the
       chooser groups by and what removal is keyed on, asserted below. */
    t('...and one compact Add agent control, not three role containers',
      adult.addControls === 1 && adult.roles.length === 0, adult.roles);
    t('adult: the paediatric section does not exist — not hidden, absent',
      adult.pedsNodes === 0 && adult.pedsWords === false,
      { nodes:adult.pedsNodes, words:adult.pedsWords });
    /* THE CLAIM THAT MATTERS MOST, and it is now checkable in one number. */
    t('adult: the centre splits about 60/40 between plan and airway',
      !!adult.geo && adult.geo.split >= 55 && adult.geo.split <= 65,
      adult.geo && adult.geo.split);
    /* Development vocabulary must not reach a clinician. */
    t('adult: no "Phase n" anywhere in the product UI', adult.noDevWords === true);
    /* The route control duplicated what the agents already say and
       contradicted itself the moment a plan held both a volatile and an IV
       agent. It is gone, not hidden. */
    t('adult: there is no primary Route selector',
      adult.noRouteControl === true && !/id:'inhalational'/.test(INDC));
    t('adult: nothing is selected, and no control is pre-set',
      adult.selected === 0 && adult.segOn === 0, adult);
    t('adult: no catalogue is open until one is asked for', adult.openLists === 0);
    t('adult: the induction reference scrolls in its own box',
      adult.refScrolls === true);

    /* ── BUILD A PLAN: ADD, ADD AGAIN, REMOVE ONE ──────────────────────
       A ROLE MAY HOLD MORE THAN ONE AGENT. An earlier revision made selection
       a replace, so choosing a second opioid silently removed the first —
       which is wrong about anaesthesia, not merely opinionated about UI. A
       plan carrying midazolam and propofol, or fentanyl and remifentanil, is
       ordinary. These assert that adding adds, and that removal takes exactly
       one agent out. */
    const built = await s.pg.evaluate(`(() => {
      /* Only one role's list is open at a time, so add() opens the role it
         needs rather than assuming the previous call left it open. */

      const chooser = () => document.querySelector('#induction-host .pl-chooser');
      const open = () => { if (!chooser()) document.querySelector('#induction-host .pl-add').click(); };
      const add = (role, id) => { open(); document.querySelector('#induction-host [data-alt="'+id+'"]').click(); };
      /* Grouped back into roles from the flat grid, using each card's own
         data-role — the state is still per role even though the display is
         one list. */
      const read = () => ['induction','analgesia','nmb'].map(k => {
        const cards = ${ind('.pl-sel')}.filter(c => c.dataset.role === k);
        return { role:k,
          drugs:cards.map(c => (c.querySelector('.pl-sel-n')||{}).textContent),
          rules:cards.map(c => (c.querySelector('.pl-rule')||{}).textContent),
          amts:cards.map(c => (c.querySelector('.pl-amt')||{}).textContent),
          warns:cards.filter(c => c.querySelector('.idc-warn')).length,
          preps:cards.filter(c => c.querySelector('.pl-prep')).length };
      });
      add('induction','drug.propofol');
      add('analgesia','drug.fentanyl');
      add('nmb','drug.rocuronium');
      const three = read();
      /* a SECOND agent in a role the clinician has already filled */
      add('induction','drug.midazolam');
      const two = read();
      /* removing one must not disturb the other */
      const card = ${ind('.pl-sel')}.find(c => /Propofol/.test(c.textContent));
      card.querySelector('.pl-x').click();
      const afterRemove = read();
      /* pressing an already-selected agent in the list takes it out too */
      add('analgesia','drug.fentanyl');       /* pressing it again removes it */
      const afterToggleOff = read();
      return { three, two, afterRemove, afterToggleOff,
               sub:(document.querySelector('#induction-host .wf-sub')||{}).textContent };
    })()`);
    const R = (a, r) => a.filter(x => x.role === r)[0];
    t('a selected agent enters its role, and only its role',
      R(built.three,'induction').drugs.join() === 'Propofol' &&
      R(built.three,'analgesia').drugs.join() === 'Fentanyl' &&
      R(built.three,'nmb').drugs.join() === 'Rocuronium',
      built.three.map(x => x.drugs));
    /* CANONICAL DOSE, VISIBLE IMMEDIATELY. 75 kg: 1.5–2.5 mg/kg = 113–188. */
    t('...showing the per-kg rule and the amount for this patient',
      /1\.5–2\.5\s*mg\/kg TBW/.test(R(built.three,'induction').rules[0]) &&
      /113–188/.test(R(built.three,'induction').amts[0]),
      R(built.three,'induction'));
    t('...with its preparation and its warning',
      R(built.three,'induction').preps === 1 && R(built.three,'induction').warns === 1 &&
      R(built.three,'nmb').warns === 1, built.three);
    /* THE CORRECTION. */
    t('a second agent in the same role JOINS the first',
      R(built.two,'induction').drugs.length === 2 &&
      R(built.two,'induction').drugs.indexOf('Propofol') >= 0 &&
      R(built.two,'induction').drugs.indexOf('Midazolam') >= 0,
      R(built.two,'induction').drugs);
    t('...each with its own canonical dose',
      R(built.two,'induction').amts.length === 2 &&
      R(built.two,'induction').amts.every(a => a.length > 0),
      R(built.two,'induction').amts);
    t('...and the other roles are untouched',
      R(built.two,'analgesia').drugs.join() === 'Fentanyl' &&
      R(built.two,'nmb').drugs.join() === 'Rocuronium', built.two.map(x => x.drugs));
    t('removing one agent leaves the other in that role',
      R(built.afterRemove,'induction').drugs.join() === 'Midazolam',
      R(built.afterRemove,'induction').drugs);
    t('...and leaves every other role alone',
      R(built.afterRemove,'analgesia').drugs.join() === 'Fentanyl' &&
      R(built.afterRemove,'nmb').drugs.join() === 'Rocuronium',
      built.afterRemove.map(x => x.drugs));
    t('pressing a selected agent in the list removes it too',
      R(built.afterToggleOff,'analgesia').drugs.length === 0,
      R(built.afterToggleOff,'analgesia').drugs);

    /* THE CHOOSER: every canonical agent, grouped by role, and costing
       nothing at all when closed. */
    const alts = await s.pg.evaluate(`(() => {
      const add = () => document.querySelector('#induction-host .pl-add');
      /* start from a known state: the previous block may have left it open */
      if (document.querySelector('#induction-host .pl-chooser')) add().click();
      const before = ${ind('.pl-chooser')}.length;
      add().click();
      const box = document.querySelector('#induction-host .pl-chooser');
      const names = [...box.querySelectorAll('.pl-alt-n')].map(e => e.textContent);
      const groups = [...box.querySelectorAll('.ch-l')].map(e => e.textContent);
      const doses = [...box.querySelectorAll('.pl-alt-d')].map(e => e.textContent.trim());
      const CC = window.ClinicalContent, wt = window.patientContext.anthropometrics.weight;
      const canonical = ['induction','analgesia','nmb']
        .reduce((a,g) => a.concat(CC.visibleDrugsInGroup(g, wt).map(d => d.name)), []);
      add().click();
      const after = ${ind('.pl-chooser')}.length;
      return { names, canonical, doses, groups, before, after };
    })()`);
    t('every canonical agent is offered, from every role',
      alts.names.join() === alts.canonical.join(), { shown:alts.names, canonical:alts.canonical });
    t('...grouped by the canonical roles, in the data\'s own words',
      alts.groups.join(' / ') ===
      'Induction and sedation / Opioids and analgesia / Neuromuscular blockade', alts.groups);
    t('...each carrying its own dose, from the same source',
      alts.doses.every(d => d.length > 0), alts.doses);
    /* CLOSED IS NOT RENDERED. A collapsed container still reserves a row. */
    t('...and the chooser costs nothing at all when closed',
      alts.before === 0 && alts.after === 0, alts);

    /* ── TECHNIQUE RECORDS; IT DOES NOT PRESCRIBE ───────────────────────
       There is no route control any more, so only technique is exercised —
       and what must not change is that it touches no dose. */
    const ctl = await s.pg.evaluate(`(() => {
      const before = ${doseSnapshot};
      const plan = () => ${ind('.pl-sel-n')}.map(e => e.textContent);
      const planBefore = plan();
      const seg = txt => ${ind('.pl-sg')}.find(x => x.textContent.trim() === txt);
      seg('Modified RSI').click();
      const afterRoute = { doses: ${doseSnapshot}, plan: plan(),
        pressed: ${ind('.pl-sg.on')}.map(x => x.textContent.trim()) };
      seg('Classic RSI').click();
      const afterTech = { doses: ${doseSnapshot}, plan: plan(),
        pressed: ${ind('.pl-sg.on')}.map(x => x.textContent.trim()) };
      return { before, planBefore, afterRoute, afterTech,
               labelled: [...${ind('.pl-rl')}, ...${ind('.pl-sg')}, ...${ind('.wf-t')},
                          ...${ind('.pl-sel-n')}]
                 .some(e => /recommend|preferred|suggested|first.line|drug of choice/i
                   .test(e.textContent)),
               techniqueOnDrug: ${ind('.pl-sel, .pl-alt')}
                 .some(e => /classic|modified/i.test(e.textContent)) };
    })()`);
    t('technique: switching between techniques changes no dose',
      JSON.stringify(ctl.before) === JSON.stringify(ctl.afterRoute.doses),
      Object.keys(ctl.before).filter(k => ctl.before[k] !== ctl.afterRoute.doses[k]));
    t('technique: and no drug enters or leaves the plan',
      JSON.stringify(ctl.planBefore) === JSON.stringify(ctl.afterRoute.plan), ctl.afterRoute.plan);
    t('technique: not one dose changes',
      JSON.stringify(ctl.before) === JSON.stringify(ctl.afterTech.doses),
      Object.keys(ctl.before).filter(k => ctl.before[k] !== ctl.afterTech.doses[k]));
    t('technique: and no drug enters or leaves the plan',
      JSON.stringify(ctl.planBefore) === JSON.stringify(ctl.afterTech.plan), ctl.afterTech.plan);
    t('it records the choice it was given, and only one at a time',
      ctl.afterTech.pressed.join() === 'Classic RSI', ctl.afterTech.pressed);
    t('nothing is labelled recommended or preferred', ctl.labelled === false);
    /* A TECHNIQUE IS NOT A BLOCKER. Classic RSI was once bound to
       suxamethonium and Modified RSI to rocuronium; neither name may appear
       on a drug again. */
    t('no agent carries a technique name', ctl.techniqueOnDrug === false);
    /* The role is named in the chooser now, where grouping is what you are
       looking for; on the card the class badge carries it. Either way it is
       named for the drug class and never for the technique. */
    t('...and the blocker group is named for the drug class, not the technique',
      /Neuromuscular blockade/i.test(await s.pg.evaluate(
        `(() => { const a = document.querySelector('#induction-host .pl-add');
                  if (!document.querySelector('#induction-host .pl-chooser')) a.click();
                  const t = [...document.querySelectorAll('#induction-host .ch-l')]
                    .map(e => e.textContent).join(' | ');
                  a.click(); return t; })()`)));
    t('no RSI dose is invented for rocuronium',
      !/rsi[^<]{0,40}\d+(\.\d+)?\s*(–|-)?\s*\d*\s*mg\/kg/i.test(INDC) &&
      /1\.2 mg\/kg for RSI/.test(IDX), 'the RSI context stays in the prep note');

    /* New Case ends the plan with the case it belonged to. */
    const cleared = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','30'); set('i-sex','F'); set('i-height','165'); set('i-weight','60');
      compute();
      return { selected: ${ind('.pl-sel')}.length,
               segOn: ${ind('.pl-sg.on')}.length,
               chooser: ${ind('.pl-chooser')}.length,
               add: ${ind('.pl-add')}.length };
    })()`);
    t('New Case ends the plan and the technique with it',
      cleared.selected === 0 && cleared.segOn === 0 && cleared.chooser === 0 &&
      cleared.add === 1, cleared);

    /* A child. The paediatric section appears, and its values are the ones
       compute() published — the same ones the derived strip is showing. */
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
      return { titles: ${ind('.wf-sec .wf-t')}.map(n => n.textContent), pdx,
               nums: ${ind('.wf-sec .wf-n')}.map(n => n.textContent),
               ctxLma:P.lma, ctxIgel:P.igel, airway: window.airwayPlan };
    })()`);
    /* READING ORDER FOLLOWS THE GEOMETRY. The backup airway left the side
       column to become a strip across the centre, so it now reads after the
       whole column pair rather than in the middle of it — which for a child
       puts the paediatric context, still beside the plan in that column,
       ahead of it. Both remain between the airway plan and the reference. */
    t('child: the paediatric section appears in the airway column, above the strip',
      child.titles.join(' / ') ===
      'Induction plan / Airway plan / Paediatric context / ' +
      'Backup difficult airway / Drug reference', child.titles);
    /* THE SAME PROPERTY WITH ONE MORE SECTION IN PLAY. This is what a
       hard-coded number cannot satisfy for both patients at once, and it is
       satisfied WITHOUT rendering a hidden paediatric section for the adult:
       the assertion above counts three numbered sections, this one counts
       four, and both are contiguous. */
    t('child: ...and so do theirs, with the paediatric section among them',
      contiguous(child.nums) && child.nums.filter(x => /^\d+$/.test(x)).length === 4,
      child.nums);
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

    /* THE SOURCE RULE, unchanged from Phase 1. The workstation may read the
       clinical data; it may not become clinical data. */
    t('induction.js declares no dose of its own',
      !/\b(mg|mcg|microgram|units?)\s*\/\s*kg\b/i.test(INDC) &&
      !/\bdoses\s*:/.test(INDC), 'a dose literal appeared in induction.js');
    /* The selector it reads through is now visibleDosesInGroup — one row per
       reviewed dose rather than one per drug, and population-aware. The rule
       being asserted is unchanged: the workstation reads the canonical
       selector and holds no drug list of its own. */
    t('...and reads every drug through the canonical group selector',
      /visibleDosesInGroup/.test(INDC) && !/DRUGS\s*[.[]/.test(INDC));
    t('...and every airway value through window.airwayPlan',
      /root\.airwayPlan/.test(INDC) &&
      !/lmaForWeight|igelForWeight|neoETT/.test(INDC));
    t('...and its roles are the canonical groups, with no invented one',
      /group:'induction'/.test(INDC) && /group:'analgesia'/.test(INDC) &&
      /group:'nmb'/.test(INDC) && !/adjunct/i.test(INDC));
    /* WAS: also asserted `var chosen = null` for the route. The route control
       is gone, and its state went with it rather than being left dangling —
       so the assertion is that no route state EXISTS, which is stronger than
       checking it defaults to null. */
    t('...and nothing is chosen by default — not a technique, not a drug',
      /var technique = null/.test(INDC) && /var picked = \{\}/.test(INDC));
    t('...and no route is stored or derived at all',
      !/var chosen/.test(INDC) && !/STRATEGIES/.test(INDC));
    t('engine.html fills the workstation after it builds the host',
      ENGC.indexOf('id="induction-host"') < ENGC.indexOf('window.Induction.render()'));
    t('...and New Case ends the plan before it recomputes',
      ENGC.indexOf('window.Induction.clear()') < ENGC.indexOf('window.compute()'));

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
      /* The reference's first row is propofol, and its second dose line is the
         amount for THIS patient. Reading it here proves the edit reached the
         canonical renderer, not just the header. */
      out.reweighed = (document.querySelector('#induction-host #iref-body .dtab-d2')||{}).textContent||'';
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
      /* The reference's card list became the shared table, so the same four
         ranks are read from the row: the drug name, the amount for this
         patient, the per-kg rule it came from, and the indication label
         under the name. The RELATIONSHIP asserted below is unchanged. */
      return { lead:px('.wfl-t'), heading:px('#output .wf-t'),
               drug:px('#iref-body .dtab-n'), amount:px('#iref-body .dtab-d2'),
               rule:px('#iref-body .dtab-d1'), label:px('#iref-body .dtab-use'),
               airwayValue:px('.awp-v'), airwayLabel:px('.awp-l'),
               timer:px('.ws-rail .lt-time'), timerLabel:px('.ws-rail .lt-head') };
    })()`);
    /* WAS: "the workspace lead outranks a section heading". That encoded the
       lead as a page title. It is a one-line breadcrumb now — the tab strip
       already names the workspace and the first section names itself — so it
       is deliberately QUIETER than the content it introduces. The ranking
       that matters, heading over drug over label, is asserted below. */
    t('the workspace lead is quieter than the content it introduces',
      rank.lead < rank.heading, rank);
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
    /* THE CARD LIST IS A TABLE NOW, and the class column carries what the
       card's header band carried: the colour as a rule down the row's leading
       edge, the badge filled in the same hue, the class named in text. The
       three properties asserted are the same three; only where they are read
       from has moved. */
    /* PHASE 3 MOVED THE CLASS OUT OF ITS OWN COLUMN. The colour is the rule
       down the row's leading edge and the badge sits beside the drug name;
       the three properties asserted are the same three, read from where they
       now live. */
    const col = await s.pg.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#induction-host #iref-body tr.dtab-r')];
      const seen = {};
      rows.forEach(r => { seen[getComputedStyle(r).getPropertyValue('--pc').trim()] = 1; });
      const first = rows[0];
      const firstCell = first ? first.querySelector('td') : null;
      const rule = firstCell ? getComputedStyle(firstCell, '::before') : null;
      return { cards:rows.length, distinctColours:Object.keys(seen).filter(Boolean).length,
               bandTinted:rule ? rule.backgroundColor : '',
               ruleWidth:rule ? parseFloat(rule.width) : 0,
               badgeFilled:getComputedStyle(first.querySelector('.dtab-name .pc')).backgroundColor,
               everyCardNamesItsClass:rows.every(r => {
                 const b = r.querySelector('.dtab-name .pc');
                 return !!b && b.textContent.trim().length > 0; }) };
    })()`);
    t('drug rows carry several distinct class colours',
      col.distinctColours >= 4, col.distinctColours);
    t('...the class rule is painted in the row colour, not left transparent',
      !/rgba\(0, 0, 0, 0\)/.test(col.bandTinted) && col.ruleWidth >= 2,
      { colour:col.bandTinted, width:col.ruleWidth });
    t('...the badge is filled with it', !/rgba\(0, 0, 0, 0\)/.test(col.badgeFilled),
      col.badgeFilled);
    /* COLOUR IS NEVER THE ONLY CUE — the same rule clinical-index.js states. */
    t('...and every row still names its class in text',
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
        /* WAS: "SOS is a fixed control". That encoded the floating action
           button, which was replaced because a permanent red circle sat over
           whatever clinical control scrolled under it. The protected claim is
           that an emergency control is reachable WITHOUT SCROLLING, and it is
           asserted directly below by scrolling 2000px and checking the button
           is still on screen — a stronger test than naming its CSS position. */
        t('390: the emergency control is on screen', m.sosShown === true, m.sosFixed);
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
      /* WAS: /^Phase 1$/. "Phase" was development vocabulary that reached the
         product; the ordinal stays because it orders the eight workspaces of
         a case, the word does not. */
      t(w + ': the workspace ordinal reads as an ordinal, not as step one',
        m.phaseIsCircle === false && /^1 of 8$/.test(m.phaseText), m.phaseText);
      t(w + ': ...and no development vocabulary reaches the product',
        !/phase\s*\d/i.test(m.phaseText), m.phaseText);
      t(w + ': nothing overflows sideways', m.overflow <= 0, m.overflow);
      await v.ctx.close();
    }

    /* ══ ONE DOSE, WHEREVER IT IS SHOWN ═════════════════════════════════
       PHASE 3 put the reference in two places: the Drug reference workspace
       over every published drug, and the induction column over the groups an
       induction reaches for. They are the same engine over the same rows, and
       this is the assertion that keeps them so.

       A dose that reads 1.5–2.5 mg/kg TBW in one and 113–188 mg in the other
       is not a presentation difference, it is two answers to one question. So
       every drug that appears in BOTH is compared cell for cell — the per-kg
       rule, the weight basis, the amount for this patient and the preparation
       — at an adult weight and again at a paediatric one, because a scaling
       bug hides at exactly one weight.                                     */
    console.log('\nONE DOSE, TWO MOUNTS');
    {
      const v = await openEngine(b, { width:1440, height:1250 });
      const cmp = await v.pg.evaluate(`(() => {
        const set = (i,val) => { const e = document.getElementById(i);
          if (e) { e.value = val; e.dispatchEvent(new Event('change',{bubbles:true})); } };
        /* THE FIGURE AND ITS UNIT ARE SEPARATE ELEMENTS in the table — the
           unit sits back visually — so both halves are read, or the
           comparison would pass while one mount printed mg and the other
           printed nothing at all. */
        const txt = (r, sel) => [...r.querySelectorAll(sel)]
          .map(e => e.textContent).join(' ');
        const readMount = id => {
          const out = {};
          [...document.querySelectorAll('#'+id+'-body tr.dtab-r')].forEach(r => {
            out[r.dataset.drug] = {
              rule:txt(r, '.dtab-d1, .dtab-du'),
              amount:txt(r, '.dtab-d2, .dtab-au'),
              prep:txt(r, '.dtab-p1')
            };
          });
          return out;
        };
        const both = () => {
          setDomain('drugs'); const wide = readMount('dref');
          setDomain('induction'); const narrow = readMount('iref');
          /* and what the PLAN itself prints for the same drug */
          Induction.clearPlan();
          ['drug.propofol','drug.fentanyl','drug.rocuronium'].forEach(id => {
            const b = document.querySelector('#iref-body [data-plan-for="'+id+'"]');
            if (b) b.click();
          });
          const plan = {};
          [...document.querySelectorAll('#induction-host .pl-sel')].forEach(c => {
            plan[c.dataset.drug] = {
              rule:(c.querySelector('.pl-rule')||{}).textContent || '',
              amount:(c.querySelector('.pl-amt')||{}).textContent || '',
              prep:(c.querySelector('.pl-prep')||{}).textContent || '' };
          });
          return { wide, narrow, plan };
        };
        newCase();
        set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
        set('i-height','175'); set('i-weight','75'); set('i-asa','II');
        compute();
        const adult = both();
        set('i-age','4'); set('i-sex','F'); set('i-height','103'); set('i-weight','16');
        compute();
        const child = both();
        return { adult, child };
      })()`);

      /* WHITESPACE IS NOT A CLINICAL DIFFERENCE. The plan card puts a space
         between the figure and its unit and the table lets CSS do it, so the
         strings differ by one character while the values are the same. Every
         digit, unit and weight basis still has to match exactly — that is
         what this compares. */
      const flat = s => s.replace(/\s+/g, '');
      const agree = (o, label) => {
        const shared = Object.keys(o.narrow).filter(k => o.wide[k]);
        const bad = shared.filter(k =>
          flat(o.wide[k].rule)   !== flat(o.narrow[k].rule) ||
          flat(o.wide[k].amount) !== flat(o.narrow[k].amount) ||
          flat(o.wide[k].prep)   !== flat(o.narrow[k].prep));
        t(label + ': the two reference mounts print the identical dose',
          shared.length >= 10 && bad.length === 0,
          { compared:shared.length, disagreed:bad.map(k =>
            k + ' | ' + flat(o.wide[k].amount) + ' vs ' + flat(o.narrow[k].amount)) });
        const planned = Object.keys(o.plan);
        const badPlan = planned.filter(k => !o.narrow[k] ||
          flat(o.plan[k].rule)   !== flat(o.narrow[k].rule) ||
          flat(o.plan[k].amount) !== flat(o.narrow[k].amount) ||
          flat(o.plan[k].prep)   !== flat(o.narrow[k].prep));
        t(label + ': ...and the induction plan prints the identical dose too',
          planned.length === 3 && badPlan.length === 0,
          { planned:planned.length, disagreed:badPlan.map(k =>
            k + ' | plan ' + flat((o.plan[k]||{}).amount) +
            ' vs reference ' + flat((o.narrow[k]||{}).amount)) });
      };
      agree(cmp.adult, 'adult 75 kg');
      agree(cmp.child, 'child 16 kg');
      /* And the scaling is real — the same drug reads differently at the two
         weights, so "identical" above is agreement and not two frozen
         strings. */
      t('a weight-based dose actually rescales between the two patients',
        cmp.adult.narrow['drug.propofol'].amount !==
        cmp.child.narrow['drug.propofol'].amount,
        { adult:cmp.adult.narrow['drug.propofol'].amount,
          child:cmp.child.narrow['drug.propofol'].amount });
      /* A RATE IS NOT AN AMOUNT. renderDose refuses to convert mcg/kg/min,
         and the table must not print a number of milligrams beside one. */
      t('...and a rate is never converted into an amount in either mount',
        (cmp.adult.narrow['drug.remifentanil'] || {}).amount === '' &&
        (cmp.adult.wide['drug.remifentanil'] || {}).amount === '',
        { narrow:(cmp.adult.narrow['drug.remifentanil']||{}).amount,
          wide:(cmp.adult.wide['drug.remifentanil']||{}).amount });
      /* AND IT IS NOT SILENTLY ABSENT EITHER. An earlier revision put the
         rate in the patient column in the accent reserved for the computed
         dose, which reads as "give 0.2-0.7 of something". The rate belongs
         where the rule goes, and the patient column has to say why there is
         no number in it rather than printing an em dash that looks like
         missing data. */
      const rate = await v.pg.evaluate(`(() => {
        const pick = id => {
          const r = document.querySelector('#iref-body tr[data-drug="'+id+'"]');
          if (!r) return null;
          return { dose:(r.querySelector('.dtab-rule')||{}).textContent.replace(/\\s+/g,' ').trim(),
                   patient:(r.querySelector('.dtab-dose')||{}).textContent.trim(),
                   accent:!!r.querySelector('.dtab-dose .dtab-d2') };
        };
        setDomain('induction');
        return { remi:pick('drug.remifentanil'), dex:pick('drug.dexmedetomidine'),
                 prop:pick('drug.propofol') };
      })()`);
      t('a rate is printed in the Dose column, with its per-kg unit intact',
        /0\.05.0\.2\s*mcg\/kg\/min/.test(rate.remi.dose) &&
        /0\.2.0\.7\s*mcg\/kg\/h/.test(rate.dex.dose),
        { remifentanil:rate.remi.dose, dexmedetomidine:rate.dex.dose });
      t('...and the patient column says infusion, not a bolus and not a dash',
        rate.remi.patient === 'infusion' && rate.dex.patient === 'infusion' &&
        rate.remi.accent === false && rate.dex.accent === false, rate);
      /* The patient here is whichever one the block left set — the point is
         that a weight-based drug HAS a computed amount in the accent, not
         which weight it was computed for; the two-mount comparison above
         already pins the values at both weights. */
      t('...while a weight-based drug still carries its computed amount there',
        rate.prop.accent === true && /\d/.test(rate.prop.patient), rate.prop);
      t('no runtime errors while comparing', v.errs.length === 0, v.errs.slice(0,2));
      await v.ctx.close();
    }

    /* ── AN ADULT-ONLY DOSE REACHES NO PART OF A CHILD'S PAGE ────────────
       The row-level guarantee is asserted in maintenance-content.test.js
       against the model. This asserts the one that actually matters: that
       nothing anywhere in the rendered document carries the number. A value
       withheld from the visible cell and still sitting in a title attribute,
       a data- attribute, an aria-label or a collapsed detail panel is not
       withheld, it is hidden — and the induction plan, the search index and
       the inline detail all read the same record.

       No shipped record is classified yet, so propofol's dose is classified
       adult-only at runtime. This is the state the clinical migration will
       create, tested before it is created. */
    {
      const v = await openEngine(b, { width:1440, height:1150 });
      const r = await v.pg.evaluate(`(() => {
        newCase();
        const set = (i,x) => { const e = document.getElementById(i); if (e) e.value = x; };
        set('i-age','3'); set('i-age-unit','y'); set('i-sex','M');
        set('i-height','96'); set('i-weight','15'); set('i-asa','II');
        compute();
        const before = document.getElementById('output').innerText;
        const d = window.ClinicalContent.byId('drug.propofol');
        d.doses[0].populationClass = 'A';
        drefRender('dref'); drefRender('iref');
        if (window.Induction && Induction.render) Induction.render();
        const out = document.getElementById('output');
        const row = [...out.querySelectorAll('tr.dtab-r')]
          .find(x => x.dataset.drug === 'drug.propofol');
        return {
          beforeHadAmount: /23.38\\s*mg/.test(before),
          present: !!row,
          name: row && row.querySelector('.dtab-n').textContent,
          colour: row && getComputedStyle(row).getPropertyValue('--pc').trim(),
          badge: !!row && !!row.querySelector('.pc'),
          coverage: row && (row.querySelector('.dtab-cov')||{}).textContent,
          addBtn: !!(row && row.querySelector('.dtab-add button')),
          height: row && Math.round(row.getBoundingClientRect().height),
          neighbours: [...out.querySelectorAll('tr.dtab-r')]
            .filter(x => x.dataset.drug !== 'drug.propofol')
            .slice(0,4).map(x => Math.round(x.getBoundingClientRect().height)),
          /* EVERY string in the canonical render paths, not just the visible
             text — a value withheld from a cell and still sitting in a title
             attribute or a collapsed panel is hidden, not withheld.

             #sed-inline-body is excluded and named rather than silently
             skipped. It is the legacy SED[] TCI reference, which bypasses
             ClinicalContent entirely: it hard-codes its own propofol
             induction bolus, which is not even the canonical value, and
             scales it by weight with no publishability or population gate.
             The population gate cannot reach it because it was never
             canonical. Asserted separately below. */
          html: (() => {
            const c = out.cloneNode(true);
            const legacy = c.querySelector('#sed-inline-body');
            if (legacy) legacy.remove();
            return c.innerHTML;
          })(),
          legacyHtml: (out.querySelector('#sed-inline-body') || {}).innerHTML || '',
          text: out.innerText
        };
      })()`);

      t('paediatric: the adult-only drug keeps its tile',
        r.present && r.name === 'Propofol', r.name);
      t('...its class colour and its badge',    !!r.colour && r.badge, r.colour);
      t('...and shows the coverage line instead of a dose',
        r.coverage === 'Pediatric dose not reviewed', r.coverage);
      t('...with no Add control implying a reviewed dose exists', r.addBtn === false);
      t('...at a row height in line with its neighbours',
        r.height > 0 && r.height <= Math.max(...r.neighbours) + 8,
        { row:r.height, neighbours:r.neighbours });
      t('the same page DID print an amount before the record was classified',
        r.beforeHadAmount === true, 'so the assertion below is not vacuous');
      /* The shipped canonical record is 1.5–2.5 mg/kg; x 15 kg = 23–38 mg. */
      const NUMS = ['23–38','23-38','1.5–2.5 mg/kg','1.5-2.5 mg/kg'];
      const inHtml = NUMS.filter(s => r.html.includes(s));
      t('NO SCALED ADULT AMOUNT APPEARS ANYWHERE IN THE CANONICAL DOM — not in '+
        'text, not in an attribute, not in a collapsed panel', inHtml.length === 0, inHtml);
      /* DEFECT I, PINNED WHERE IT LIVES. The legacy TCI panel still prints a
         propofol induction bolus for this three-year-old, from its own inline
         value, ungated. This test does not pass because that is acceptable —
         it exists so the leak stays confined to the one container we know
         about and cannot quietly reappear in a canonical path. */
      t('the remaining leak is confined to the legacy SED[] panel, and is its '+
        'own inline value rather than the canonical one',
        /2.2\.5 mg\/kg/.test(r.legacyHtml) && !/1\.5.2\.5/.test(r.legacyHtml),
        'legacy TCI reference: ungated, and disagrees with the canonical record');
      t('...and no clinical prohibition is implied by the coverage wording',
        !/contraindicat|not recommended|unsafe|do not use/i.test(r.text));
      t('no runtime errors while withholding', v.errs.length === 0, v.errs.slice(0,2));
      await v.ctx.close();
    }
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
