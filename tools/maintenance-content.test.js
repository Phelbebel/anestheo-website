#!/usr/bin/env node
/* maintenance-content.test.js — PHASE 4A: THE MAINTENANCE CONTENT MODEL
 *
 * Phase 4A added no clinical value. It added the SHAPE a reviewed maintenance
 * record will have, the selector that reads it, and the guarantee that the
 * selector cannot answer with the wrong dose. This suite exists to hold that
 * guarantee while the records are still missing, and to keep holding it once
 * they arrive.
 *
 * THE ONE PROPERTY EVERYTHING HERE PROTECTS
 * -----------------------------------------
 *   Asking the model for a dose it does not have must return NOTHING.
 *
 * Not the first dose in the list. Not the induction bolus relabelled. Not a
 * value derived from one. A maintenance workspace built on a model that falls
 * back is a workspace that will one day print an induction dose of propofol
 * under the word "maintenance", and no amount of UI care prevents that if the
 * data layer permits it.
 *
 * The suite is deliberately node-only. Everything asserted is a property of
 * the content model, and a browser would only add a place for the answer to
 * change on the way to the screen.
 */
const fs = require('fs');
const REPO = '/home/user/anestheo-website';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 180);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(66) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(66) + ' ' + fmt(d)); }
};
const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
                   .replace(/<!--[\s\S]*?-->/g, ' ');

global.window = global;
require(REPO + '/clinical-index.js');
const CC = window.ClinicalContent;
const IDX = read('clinical-index.js'), IDXC = code(IDX);
const ENG = read('engine.html'), ENGC = code(ENG);

console.log('\n=== PHASE 4A · MAINTENANCE CONTENT MODEL ====================\n');

/* ── 1. THE PUBLISHING GATE IS UNCHANGED ─────────────────────────────────
   Provenance is the safety gate this whole file is built on. Phase 4A must
   not have widened it by a single record. */
console.log('1. THE PUBLISHING GATE');

const sevo = CC.byId('drug.sevoflurane');
t('sevoflurane is still in the dataset', !!sevo, sevo && sevo.id);
t('...still proposed-unverified', sevo.provenance.state === 'proposed-unverified',
  sevo.provenance.state);
t('...still carries no dose at all', Array.isArray(sevo.doses) && sevo.doses.length === 0,
  sevo.doses);
t('...and is not publishable', CC.isPublishable(sevo) === false);
/* THE GATE, EXERCISED RATHER THAN INSPECTED: no render path returns it. */
t('...so no group render returns it',
  CC.GROUPS.every(g => !CC.visibleDrugsInGroup(g.id, 75).some(r => r.id === 'drug.sevoflurane')));
t('...and searching for it by name returns nothing',
  CC.search('sevoflurane', { limit: 50 }).every(h => h.item.id !== 'drug.sevoflurane'),
  CC.search('sevoflurane', { limit: 50 }).map(h => h.item.id));
t('...nor does searching its trade name', CC.search('sevorane', { limit: 50 })
  .every(h => h.item.id !== 'drug.sevoflurane'));

const unpub = CC.DRUGS.filter(d => !CC.isPublishable(d));
t('every unpublishable record is invisible to every group render',
  unpub.length > 0 && CC.GROUPS.every(g =>
    CC.visibleDrugsInGroup(g.id, 75).every(r => !unpub.some(u => u.id === r.id))),
  { unpublishable: unpub.length, ids: unpub.map(d => d.id) });
t('...and the gate still admits exactly two provenance states',
  /st === 'existing-unchanged' \|\| st === 'reviewed'/.test(IDXC.replace(/\s+/g, ' ')) ||
  /existing-unchanged[\s\S]{0,40}reviewed/.test(IDXC),
  'isPublishable() accepts only existing-unchanged and reviewed');

/* ── 2. THE PHASE SELECTOR CANNOT FALL BACK ──────────────────────────────
   The reason Phase 4A exists. */
console.log('\n2. NO FALLBACK — THE POINT OF THE WHOLE PHASE');

t('the model declares a phase vocabulary', !!CC.PHASES && !!CC.PHASES.MAINTENANCE,
  CC.PHASES);
t('...and a selector that reads it',
  typeof CC.dosesForPhase === 'function' && typeof CC.visibleInGroupForPhase === 'function');

/* NOTHING declares a phase today. That is the honest state, and it is
   asserted rather than assumed — the moment a reviewed record arrives this
   number changes and the assertion below says so. */
/* TIER 1 CHANGED THIS. Eleven reviewed records declare a phase now, so the
   assertion is no longer "none does" — it is that every phase declared comes
   from the vocabulary, and that MAINTENANCE and REDOSE are still empty,
   which is the guarantee Phase 4A actually exists to hold. */
const phased = CC.DRUGS.filter(d => (d.doses || []).some(x => x.phase));
const PHASE_VALUES = Object.values(CC.PHASES);
t('every declared phase comes from the vocabulary, none invented',
  CC.DRUGS.every(d => (d.doses||[]).every(x => !x.phase || PHASE_VALUES.indexOf(x.phase) >= 0)),
  phased.map(d => d.id));
t('...and induction-scope phases are all this migration declared',
  [...new Set(CC.DRUGS.flatMap(d => (d.doses||[]).map(x => x.phase).filter(Boolean)))].sort()
    .join(',') === 'induction,intubation,rsi',
  [...new Set(CC.DRUGS.flatMap(d => (d.doses||[]).map(x => x.phase).filter(Boolean)))].sort());
t('...so every group returns nothing for maintenance',
  CC.GROUPS.every(g => CC.visibleInGroupForPhase(g.id, 75, CC.PHASES.MAINTENANCE).length === 0));
t('...and the coverage report says zero everywhere, not "unknown"',
  Object.values(CC.phaseCoverage(CC.PHASES.MAINTENANCE)).every(v => v.withPhase === 0),
  CC.phaseCoverage(CC.PHASES.MAINTENANCE));

/* THE TWO SPECIFIC HAZARDS THE BRIEF NAMES. */
const propofol = CC.byId('drug.propofol');
t('propofol carries induction records and NOTHING for maintenance',
  propofol.doses.length === 2 &&
  propofol.doses.every(d => d.phase === 'induction' && d.unit === 'mg/kg'),
  propofol.doses.map(d => d.phase + ' ' + d.unit));
t('...so asking for its maintenance dose returns NOTHING, not the bolus',
  CC.dosesForPhase(propofol, CC.PHASES.MAINTENANCE).length === 0);
t('...and no group render can present that bolus as an infusion',
  CC.visibleInGroupForPhase('induction', 75, CC.PHASES.MAINTENANCE).length === 0);

const roc = CC.byId('drug.rocuronium');
t('rocuronium carries intubation and RSI records, and nothing beyond them',
  roc.doses.length === 3 &&
  roc.doses.every(d => d.phase === 'intubation' || d.phase === 'rsi'),
  roc.doses.map(d => d.phase));
t('...so asking for a re-dose returns NOTHING',
  CC.dosesForPhase(roc, CC.PHASES.REDOSE).length === 0 &&
  CC.dosesForPhase(roc, CC.PHASES.MAINTENANCE).length === 0);
t('...and no blocker in the model carries a maintenance or re-dose entry',
  CC.DRUGS.filter(d => d.pclass === 'nmb')
    .every(d => (d.doses || []).every(x =>
      x.phase !== CC.PHASES.MAINTENANCE && x.phase !== CC.PHASES.REDOSE)),
  CC.DRUGS.filter(d => d.pclass === 'nmb').map(d => d.id + ':' + d.doses.map(x => x.phase)));
/* NO INFERENCE ANYWHERE. An interval is a clinical fact; the field is a wire. */
/* The check is for an interval VALUE, so it looks for a NON-EMPTY string
   literal. `interval:''` is a field being explicitly emptied — rowFor passes
   one through and withheldRowFor blanks one out — and neither states a
   clinical fact. Written this way the guard needs no per-call-site exemption
   and still fails on the thing it exists to catch, `interval:'20-30 min'`. */
t('no record carries a dosing interval, and none is derived',
  CC.DRUGS.every(d => (d.doses || []).every(x => x.interval == null)) &&
  !/interval\s*[:=]\s*['"`][^'"`]/.test(IDXC),
  'interval is passed through or blanked, never authored');

/* ── 3. A RATE IS STILL A RATE ───────────────────────────────────────────
   renderDose() refuses to convert mcg/kg/min into an amount. Maintenance is
   where that refusal matters most, so it is asserted here too. */
console.log('\n3. A RATE IS A RATE');

const rateDrugs = CC.DRUGS.filter(CC.isPublishable)
  .filter(d => d.doses[0] && /\/(min|h|hr)$/.test(d.doses[0].unit || ''));
t('the model holds rate-dosed drugs', rateDrugs.length >= 7, rateDrugs.length);
rateDrugs.forEach(d => {
  const row = CC.visibleDrugsInGroup(d.group, 75).find(r => r.id === d.id);
  const rendered = CC.renderDose(d.doses[0], 75);
  t('  ' + d.name.padEnd(24) + ' stays per-kg at 75 kg',
    rendered.unit === d.doses[0].unit && row.unit === d.doses[0].unit &&
    row.doseNum === '' && row.doseRule === '',
    rendered.val + ' ' + rendered.unit);
});
t('...and the same at a paediatric weight, and with no weight at all',
  rateDrugs.every(d => CC.renderDose(d.doses[0], 16).unit === d.doses[0].unit &&
                       CC.renderDose(d.doses[0], null).unit === d.doses[0].unit));

/* ── 4. REMIFENTANIL IS UNTOUCHED ────────────────────────────────────────
   It is the one genuine maintenance infusion the model already holds, and
   Phase 4A was explicitly forbidden to change it. */
console.log('\n4. THE ONE RECORD THAT ALREADY QUALIFIES');

const remi = CC.byId('drug.remifentanil');
t('remifentanil is a publishable infusion', CC.isPublishable(remi));
/* TIER 1 ADDED TWO RECORDS BESIDE IT AND CHANGED NOT ONE FIGURE OF IT. The
   legacy infusion keeps its value, its unit and its label; it gained a
   populationClass, to keep it away from children, and an evidence block that
   says existing-unchanged, which is the opposite of certifying it. */
t('...at exactly 0.05-0.2 mcg/kg/min, unchanged',
  remi.doses[0].low === 0.05 && remi.doses[0].high === 0.2 &&
  remi.doses[0].unit === 'mcg/kg/min' && remi.doses[0].label === 'Infusion',
  remi.doses[0]);
/* NOT EVEN CLASSIFIED. An earlier cut gave this record populationClass 'A'
   and a dose-level evidence block reading existing-unchanged. Both were
   removed: the class is an evidence claim and nothing has reviewed this
   value, so it carries neither, and the legacy compatibility rule keeps it
   away from children without asserting anything about it. */
t('...still uncertified, unclassified, and declaring no phase',
  remi.doses[0].evidence === undefined &&
  remi.doses[0].populationClass === undefined &&
  remi.doses[0].phase === undefined);
t('...it is not duplicated anywhere in the dataset',
  CC.DRUGS.filter(d => /remifentanil/i.test(d.name)).length === 1);
t('...and it still renders as the same rate it always did',
  JSON.stringify(CC.visibleDrugsInGroup('analgesia', 75).find(r => r.id === 'drug.remifentanil'))
    .indexOf('"val":"0.05–0.2","unit":"mcg/kg/min"') > 0);

const dex = CC.byId('drug.dexmedetomidine');
t('dexmedetomidine keeps its own indication — sedation, not maintenance',
  dex.doses[0].label === 'Sedation' &&
  dex.indications.join(',') === 'sedation,procedural sedation,awake fibreoptic',
  { label: dex.doses[0].label, indications: dex.indications });

/* ── 5. VASOPRESSORS ARE NOT MAINTENANCE ─────────────────────────────────
   Five rate-dosed drugs sit in vaso-inf. Using them to make a Maintenance
   domain look fuller is the easiest available dishonesty, so the grouping is
   asserted rather than trusted. */
console.log('\n5. VASOPRESSORS STAY WHERE THEY ARE');

const VASO = ['drug.noradrenaline', 'drug.adrenaline', 'drug.phenylephrine-inf',
              'drug.dobutamine', 'drug.vasopressin'];
t('every vasopressor infusion is still in a vasopressor group',
  VASO.every(id => /^vaso-/.test(CC.byId(id).group)),
  VASO.map(id => id + ':' + CC.byId(id).group));
t('...and none of them declares a maintenance phase',
  VASO.every(id => CC.dosesForPhase(CC.byId(id), CC.PHASES.MAINTENANCE).length === 0));

/* ── 6. MAC IS AN AGE FACTOR, NOT AN AGENT MAC ───────────────────────────*/
console.log('\n6. MAC');

t('the model holds no agent MAC value',
  !CC.DRUGS.some(d => /\bMAC\b/.test(JSON.stringify(d.doses || []))),
  'no dose expresses a MAC multiple');
t('...only a calculator descriptor, whose summary says what it is',
  (CC.ITEMS.find(i => i.id === 'calc.mac') || {}).summary === 'Relative to a 40-year-old',
  (CC.ITEMS.find(i => i.id === 'calc.mac') || {}).summary);
/* The age factor is computed in compute() and published as derived.mac. It
   must not be multiplied by anything, because there is nothing to multiply. */
t('the age factor is the standard age adjustment and nothing more',
  /macAge\s*=\s*Math\.pow\(10,\s*-0\.00269\s*\*\s*\(\(age\|\|40\)\s*-\s*40\)\)/.test(
    ENGC.replace(/\s+/g, ' ').replace(/ /g, '')) ||
  /Math\.pow\(10,-0\.00269/.test(ENGC.replace(/\s+/g, '')),
  'single age-adjustment expression');
t('...and nothing multiplies it by an agent MAC',
  !/mac(Age)?\s*\*\s*(1\.[0-9]|2|6|sevo|des|iso)/i.test(ENGC),
  'no agent MAC multiplication');

/* ── 7. TCI DOES NOT EXIST, AND MUST NOT APPEAR TO ───────────────────────*/
console.log('\n7. TCI IS NOT IMPLEMENTED');

t('the canonical model exposes no TCI API',
  !Object.keys(CC).some(k => /tci|schnider|marsh|minto|eleveld|effectsite/i.test(k)),
  Object.keys(CC).join(' '));
t('...and holds no TCI model, target or constant',
  !/\b(ke0|schnider|marsh|minto|eleveld|paedfusor|kataria|effect.site|plasma target)\b/i
    .test(JSON.stringify({ d: CC.DRUGS, i: CC.ITEMS })));
/* NO COMPUTATION ANYWHERE IN THE PRODUCT. Descriptive text is category B and
   is audited separately; an implemented model would be category C. */
t('no compartment model is implemented anywhere in engine.html',
  !/\b(ke0|k10|k12|k21|k13|k31)\b/.test(ENGC) &&
  !/function\s+\w*(schnider|marsh|minto|eleveld)\w*\s*\(/i.test(ENGC),
  'no pharmacokinetic computation');

/* ── 8. LEGACY INLINE CONTENT IS NOT CANONICAL ───────────────────────────
   SED[] and tivaRows ship today and carry real clinical claims. Phase 4A does
   not delete them and does not promote them. What it asserts is that nothing
   treats them as canonical: they are not in ClinicalContent, they are not
   searchable, and they carry no provenance. */
console.log('\n8. LEGACY INLINE CONTENT');

t('SED[] exists in engine.html and is inline, not canonical',
  /var\s+SED\s*=\s*\[/.test(ENGC) && !/var\s+SED\s*=/.test(IDXC),
  'declared in engine.html only');
t('tivaRows exists in engine.html and is inline, not canonical',
  /var\s+tivaRows\s*=/.test(ENGC) && !/tivaRows/.test(IDXC));
t('...neither is reachable through ClinicalContent',
  typeof CC.SED === 'undefined' && typeof CC.tivaRows === 'undefined' &&
  !Object.keys(CC).some(k => /^(SED|tiva)/i.test(k)));
t('...neither is returned by the canonical search',
  ['schnider', 'marsh', 'minto', 'target controlled', 'effect site']
    .every(q => CC.search(q, { limit: 30 }).length === 0),
  ['schnider', 'marsh', 'minto'].map(q => q + ':' + CC.search(q, { limit: 30 }).length));
t('...and no canonical record carries their values',
  !CC.DRUGS.some(d => /mcg\/mL|ng\/mL/.test(JSON.stringify(d.doses || []))),
  'no Ce target is in the dataset');
/* THE CONFLICT THAT MATTERS. tivaRows prints a propofol manual infusion rate
   the canonical model does not hold. It is legacy reference content and stays
   until reviewed — but nothing may read it as data. */
t('the propofol infusion rate in tivaRows has no canonical counterpart',
  /Manual infusion/.test(ENG) &&
  CC.byId('drug.propofol').doses.every(x => !/\/h$/.test(x.unit)),
  'legacy display value only');

/* ── 9. THE REFACTOR CHANGED NO RENDER INPUT ─────────────────────────────
   visibleDrugsInGroup() had its body extracted into rowFor(). Every field it
   produced before, it must still produce, at every weight. */
console.log('\n9. THE REFACTOR IS ADDITIVE');

/* THE BASELINE IS IN THE REPOSITORY, not in a scratch directory. It is the
   exact output of visibleDrugsInGroup() for every group at five weights —
   null, 3.4, 16, 75 and 120 kg — captured immediately BEFORE the Phase 4A
   refactor. A guarantee that lives in /tmp is not a guarantee. */
const SNAP = REPO + '/tools/render-input-baseline.json';
if (fs.existsSync(SNAP)) {
  const before = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  let rows = 0, changed = [], removed = new Set(), added = new Set();
  Object.keys(before).forEach(k => {
    if (k === '__stats') return;
    const [gid, wtRaw] = k.split('@');
    const wt = wtRaw === 'null' ? null : parseFloat(wtRaw);
    const now = CC.visibleDrugsInGroup(gid, wt);
    if (now.length !== before[k].length) { changed.push(k + ': row count'); return; }
    before[k].forEach((ra, i) => {
      rows++;
      /* THROUGH JSON, BOTH SIDES. Several fields are undefined on some drugs —
         `warn`, `prep` and `hi` — and JSON drops an undefined value entirely.
         Comparing a parsed baseline against a live object would report those
         as newly added on every record that lacks them, which is an artifact
         of the serialisation and not a change to anything. */
      const rb = JSON.parse(JSON.stringify(now[i]));
      Object.keys(ra).forEach(f => { if (!(f in rb)) removed.add(f);
        else if (JSON.stringify(ra[f]) !== JSON.stringify(rb[f])) changed.push(k + '[' + i + '].' + f); });
      Object.keys(rb).forEach(f => { if (!(f in ra)) added.add(f); });
    });
  });
  /* RECAPTURED AFTER THE TIER 1 MIGRATION, WHICH IS THE ONLY TIME IT MOVES.
     The old snapshot predated Phase 4A and the reviewed records, so it was
     failing on both. Regenerating it is a deliberate act, done once, with
     every changed row accounted for:

       0 rows added, 0 rows removed  — the same 125 rows at the same weights
       25 drugs changed interval and phase only — the two Phase 4A wires,
          absent from the pre-4A capture and empty on every legacy record
       4 drugs changed a dose value, and they are exactly the 4 replaced:
          propofol       1.5–2.5 → 2–2.5      (113–188 → 150–188 at 75 kg)
          ketamine       1–2     → 1–4.5      (75–150  → 75–338)
          rocuronium     0.6–1.2 → 0.6        (45–90   → 45)
          suxamethonium  1–1.5   → 0.3–1.1    (75–113  → 22.5–82.5)
       rocuronium also changed prep and prepNote — Defect B, the RSI dose
          leaving the preparation string
       suxamethonium also changed use — the label was "RSI" and the reviewed
          record states the dose for intubation

     From here it is a drift guard again: anything that moves without a
     matching reviewed record behind it fails here. */
  t('the render baseline matches, field for field, at every weight',
    changed.length === 0 && removed.size === 0 && added.size === 0,
    { rowsCompared: rows, changed: changed.slice(0, 5),
      removed: [...removed], added: [...added] });
  t('...over the same 125 rows the model has always returned', rows === 125, rows);
} else {
  t('render-input snapshot present for comparison', false,
    'missing ' + SNAP);
}

/* ── 10. NO BACKEND, AUTH OR SQL SURFACE ─────────────────────────────────*/
console.log('\n10. NO BACKEND SURFACE');

t('clinical-index.js touches no backend, auth or storage',
  !/supabase|createClient|\.rpc\(|\.from\(|localStorage|sessionStorage|fetch\(/i.test(IDXC),
  'pure data module');
t('...and declares no network or credential constant',
  !/https?:\/\/|service_role|anon_key|apikey/i.test(IDXC));

/* ── 11. POPULATION ELIGIBILITY ──────────────────────────────────────────
   THE MACHINERY IS BUILT BEFORE IT HOLDS ANYTHING, AND THIS PROVES IT INERT.
   No record carries populationClass, ageBand or evidence yet, so every
   assertion below either exercises the rules against synthetic doses or
   asserts that the live dataset is unaffected. When the reviewed records
   land, the same assertions start biting on real data without being rewritten.

   The property that matters: A PATIENT THE EVIDENCE DOES NOT COVER GETS NO
   NUMBER. Not a scaled one, not a caveated one, not the nearest band.      */
console.log('\n11. POPULATION ELIGIBILITY');

const yrs = v => ({ value:v, unit:'years' });
const mos = v => ({ value:v, unit:'months' });
const dys = v => ({ value:v, unit:'days' });
const P   = (peds, age, asa) => ({ pediatric:peds, adult:!peds, age:age, asa:asa||null });
const ADULT = P(false, yrs(40));
const CHILD = P(true,  yrs(4));
const BABY  = P(true,  mos(3));
const NOAGE = null;
const el = (dose, pop) => CC.doseEligibility(dose, pop).eligible;
const why = (dose, pop) => CC.doseEligibility(dose, pop).reason;

t('the five evidence classes are declared',
  Object.values(CC.POPCLASS).sort().join('') === 'ABCDE', CC.POPCLASS);

/* A — adult-specific */
const dA = { populationClass:'A' };
t('A: adult eligible',            el(dA, ADULT));
t('A: paediatric WITHHELD',      !el(dA, CHILD) && why(dA, CHILD) === CC.WITHHELD.PAEDIATRIC);
t('A: infant WITHHELD',          !el(dA, BABY));

/* B — paediatric-specific */
const dB = { populationClass:'B' };
t('B: paediatric eligible',       el(dB, CHILD));
t('B: adult WITHHELD',           !el(dB, ADULT) && why(dB, ADULT) === CC.WITHHELD.ADULT);

/* D — one reviewed rule, both populations, ONE record */
const dD = { populationClass:'D' };
t('D: adult eligible',            el(dD, ADULT));
t('D: paediatric eligible',       el(dD, CHILD));
t('D: neonate eligible',          el(dD, BABY));

/* E — never */
const dE = { populationClass:'E' };
t('E: never eligible for anyone', !el(dE, ADULT) && !el(dE, CHILD) && !el(dE, NOAGE));
t('E: never publishable either',
  CC.isDosePublishable(CC.byId('drug.propofol'), { populationClass:'E' }) === false);

t('an unrecognised class is WITHHELD, not admitted',
  !el({ populationClass:'Z' }, ADULT) && !el({ populationClass:'Z' }, CHILD) &&
  !el({ populationClass:'Z' }, NOAGE));
t('with no patient known, classed doses still render',
  el(dA, NOAGE) && el(dB, NOAGE));

/* ── THE STRUCTURED AGE BAND ────────────────────────────────────────────
   The band says what the label said. No conversion constant decides an edge. */
console.log('\n11b. AGE BOUNDARY SEMANTICS');

t('no approximate age constant is written into the model',
  !/365\.25|30\.4375|\*\s*365\b/.test(IDXC), 'no x365.25 anywhere in clinical-index.js');

/* "3 through 16 years" — both bounds inclusive */
const band3to16 = { populationClass:'C',
  ageBand:{ min:{ value:3, unit:'years', inclusive:true },
            max:{ value:16, unit:'years', inclusive:true } } };
t('3 through 16: on the 3rd birthday ELIGIBLE',   el(band3to16, P(true, yrs(3))));
t('3 through 16: the year before WITHHELD',      !el(band3to16, P(true, yrs(2))));
t('3 through 16: 35 months WITHHELD (one month short)',
  !el(band3to16, P(true, mos(35))));
t('3 through 16: 36 months ELIGIBLE (exactly 3 years)',
  el(band3to16, P(true, mos(36))));
t('3 through 16: 16 years ELIGIBLE (inclusive upper)', el(band3to16, P(true, yrs(16))));
t('3 through 16: the day before the 17th birthday ELIGIBLE',
  el(band3to16, P(true, mos(16*12+11))));
t('3 through 16: 17 years WITHHELD',             !el(band3to16, P(true, yrs(17))));
t('3 through 16: reports the age reason, not a population reason',
  why(band3to16, P(true, yrs(2))) === CC.WITHHELD.AGE);
t('3 through 16: NO NEAREST-BAND FALLBACK for an infant', !el(band3to16, P(true, mos(3))));
t('3 through 16: an adult is WITHHELD as adult, not as age',
  !el(band3to16, ADULT) && why(band3to16, ADULT) === CC.WITHHELD.ADULT);

/* "1 month to <2 years" — inclusive lower, EXCLUSIVE upper */
const band1mTo2y = { populationClass:'C',
  ageBand:{ min:{ value:1, unit:'months', inclusive:true },
            max:{ value:2, unit:'years',  inclusive:false } } };
t('<2y: 1 month exactly ELIGIBLE (inclusive lower)', el(band1mTo2y, P(true, mos(1))));
t('<2y: 23 months ELIGIBLE (the month before the 2nd birthday)',
  el(band1mTo2y, P(true, mos(23))));
t('<2y: 24 months WITHHELD (ON the 2nd birthday, exclusive)',
  !el(band1mTo2y, P(true, mos(24))));
t('<2y: 2 years WITHHELD',                       !el(band1mTo2y, P(true, yrs(2))));
t('<2y: a 10-day-old WITHHELD (below 1 month, decided across families)',
  !el(band1mTo2y, P(true, dys(10))));
t('<2y: a 60-day-old ELIGIBLE (unambiguously past 1 month)',
  el(band1mTo2y, P(true, dys(60))));
t('<2y: a 30-day-old is UNDECIDABLE and therefore WITHHELD',
  !el(band1mTo2y, P(true, dys(30))), 'a month is 28-31 days; we do not guess');

/* "2 years to <18 years" — exclusive upper */
const band2To18 = { populationClass:'C',
  ageBand:{ min:{ value:2, unit:'years', inclusive:true },
            max:{ value:18, unit:'years', inclusive:false } } };
t('<18y: 2 years ELIGIBLE',                       el(band2To18, P(true, yrs(2))));
t('<18y: 17 years ELIGIBLE',                      el(band2To18, P(true, yrs(17))));
t('<18y: the month before the 18th birthday ELIGIBLE',
  el(band2To18, P(true, mos(17*12+11))));
t('<18y: 18 years WITHHELD (ON the birthday, exclusive)',
  !el(band2To18, P(true, yrs(18))));

/* open bounds, and the raw comparator */
t('an open lower bound still excludes above',
  CC.inAgeBand({ max:{ value:100, unit:'days', inclusive:true } }, dys(50)) &&
  !CC.inAgeBand({ max:{ value:100, unit:'days', inclusive:true } }, dys(101)));
t('an open upper bound still excludes below',
  CC.inAgeBand({ min:{ value:100, unit:'days', inclusive:true } }, dys(5000)) &&
  !CC.inAgeBand({ min:{ value:100, unit:'days', inclusive:true } }, dys(99)));
t('years and months compare exactly',   CC.compareAge(yrs(2), mos(24)) === 0);
t('weeks and days compare exactly',     CC.compareAge({value:2,unit:'weeks'}, dys(14)) === 0);
t('an overlapping cross-family comparison is undecidable, not guessed',
  CC.compareAge(dys(30), mos(1)) === null);
t('unknown age is inside no band',
  !CC.inAgeBand(band3to16.ageBand, null) &&
  !CC.inAgeBand(band3to16.ageBand, { value:null, unit:'years' }));

/* ── THE EIGHT STATED AGE-UNIT CASES, VERBATIM ──────────────────────────
   Each is the entered age as the application would hold it — a value and a
   unit, never a date — against a band in the unit its label used.          */
console.log('\n11b-ii. THE STATED AGE-UNIT CASES');

const THROUGH16 = { min:{ value:3, unit:'years', inclusive:true },
                    max:{ value:16, unit:'years', inclusive:true } };
const UNDER2    = { max:{ value:2, unit:'years', inclusive:false } };
const MIN3Y     = { min:{ value:3, unit:'years', inclusive:true } };
const MIN24MO   = { min:{ value:24, unit:'months', inclusive:true } };
const MIN2Y     = { min:{ value:2, unit:'years', inclusive:true } };

t('1  16.9 years vs "through 16 years"  → ELIGIBLE',
  CC.inAgeBand(THROUGH16, yrs(16.9)) === true, 'completed years = 16');
t('2  17 years   vs "through 16 years"  → WITHHELD',
  CC.inAgeBand(THROUGH16, yrs(17)) === false);
t('3  23 months  vs "<2 years"          → ELIGIBLE',
  CC.inAgeBand(UNDER2, mos(23)) === true, 'completed years = 1');
t('4  24 months  vs "<2 years"          → WITHHELD',
  CC.inAgeBand(UNDER2, mos(24)) === false, 'completed years = 2, bound exclusive');
t('5  35 months  vs ">=3 years"         → WITHHELD',
  CC.inAgeBand(MIN3Y, mos(35)) === false, '2 years 11 months is not 3');
t('6  36 months  vs ">=3 years"         → ELIGIBLE',
  CC.inAgeBand(MIN3Y, mos(36)) === true);
t('7  2 years    vs ">=24 months"       → ELIGIBLE',
  CC.inAgeBand(MIN24MO, yrs(2)) === true, 'compared in the bound unit: 24 vs 24');
t('8  1.9 years  vs ">=2 years"         → WITHHELD',
  CC.inAgeBand(MIN2Y, yrs(1.9)) === false, 'completed years = 1');

/* The stated worked example, both directions. */
t('2 years 11 months entered as 35 months compares correctly against a years bound',
  CC.compareAge(mos(35), { value:3, unit:'years' }) === -1 &&
  CC.compareAge(mos(36), { value:3, unit:'years' }) === 0);
t('...and 16.9 years floors to 16 against a years bound, not to 17',
  CC.compareAge(yrs(16.9), { value:16, unit:'years' }) === 0 &&
  CC.compareAge(yrs(17),   { value:16, unit:'years' }) === 1);

/* ── ROUTE-AWARE ENUMERATION ────────────────────────────────────────────*/
console.log('\n11b-iii. ROUTE NARROWING');

t('an exact route filter is available on the selector',
  CC.visibleDosesInGroup('induction', 75, ADULT, null, 'IV').length > 0 &&
  CC.visibleDosesInGroup('induction', 75, ADULT, null, 'IM').length === 1,
  'ketamine IM is the one induction record on a non-IV route');
t('...and it returns the IM record, not the IV one',
  CC.visibleDosesInGroup('induction', 75, ADULT, null, 'IM')[0].doseNum === '6.5–13');
t('...while narrowing to a route no drug has produces NO row, not a coverage row',
  CC.visibleDosesInGroup('induction', 75, ADULT, null, 'PO').length === 0);

/* ── APPLICABILITY ─────────────────────────────────────────────────────*/
console.log('\n11c. APPLICABILITY');

const asaOnly = { populationClass:'A', applicability:{ asa:['I','II'] } };
t('ASA I admitted',      el(asaOnly, P(false, yrs(40), 'I')));
t('ASA II admitted',     el(asaOnly, P(false, yrs(40), 'II')));
t('ASA III WITHHELD',   !el(asaOnly, P(false, yrs(40), 'III')));
t('ASA IV WITHHELD',    !el(asaOnly, P(false, yrs(40), 'IV')));
t('...and reports the profile reason',
  why(asaOnly, P(false, yrs(40), 'III')) === CC.WITHHELD.PROFILE);
t('AN UNEVALUATABLE CRITERION IS NOT SATISFIED — no ASA entered WITHHOLDS',
  !el(asaOnly, P(false, yrs(40), null)), 'unknown is not admitted');
/* MISSING IS NOT MISMATCHED, and the clinician can act on the difference. */
t('...and says so specifically: missing ASA gets its own reason',
  why(asaOnly, P(false, yrs(40), null)) === CC.WITHHELD.ASA);
t('...with wording that names the missing field',
  CC.COVERAGE[CC.WITHHELD.ASA] === 'ASA required to match reviewed dose');
t('...while an ASA that is present but not admitted stays generic',
  why(asaOnly, P(false, yrs(40), 'III')) === CC.WITHHELD.PROFILE);
t('...and no coverage state anywhere implies a clinical prohibition',
  Object.values(CC.COVERAGE).every(s =>
    !/contraindicat|not recommended|unavailable|unsafe|do not (use|give)/i.test(s)),
  Object.values(CC.COVERAGE));
/* ASA IS NOT MADE MANDATORY FOR EVERY CASE TO SATISFY ONE RECORD. */
t('a record that does not mention ASA is unaffected by ASA being unknown',
  el({ populationClass:'A' }, P(false, yrs(40), null)));
t('...and the patient form is not made to require ASA for this feature',
  /complete:\s*\(y != null && !!o\.sex && o\.height != null && o\.weight != null\)/
    .test(read('engine.html')),
  'complete() unchanged — applicability belongs to the dose selector');

const under65 = { populationClass:'A',
  applicability:{ ageBand:{ max:{ value:65, unit:'years', inclusive:false } },
                  asa:['I','II'] } };
t('under 65 + ASA II admitted',       el(under65, P(false, yrs(64), 'II')));
t('ON the 65th birthday WITHHELD',   !el(under65, P(false, yrs(65), 'II')));
t('over 65 WITHHELD even at ASA I',  !el(under65, P(false, yrs(80), 'I')));
t('under 65 but ASA IV WITHHELD',    !el(under65, P(false, yrs(40), 'IV')));
t('applicability is generic, not drug-specific',
  !/propofol|ketamine|rocuronium/i.test(
    /function meetsApplicability\(([\s\S]*?)\n}/.exec(IDX)[1]));
t('...and carries no comorbidity or recommendation logic',
  !/renal|hepatic|h[ae]modynamic|recommend/i.test(
    /function meetsApplicability\(([\s\S]*?)\n}/.exec(IDX)[1]));
t('population is evaluated before applicability',
  why({ populationClass:'A', applicability:{ asa:['I'] } }, CHILD) === CC.WITHHELD.PAEDIATRIC,
  'a child fails on population, never reaching ASA');

/* ── DOSE-LEVEL PUBLISHABILITY ──────────────────────────────────────────*/
console.log('\n12. DOSE-LEVEL PUBLISHABILITY');

const prop = CC.byId('drug.propofol');
t('a migrated dose with no evidence block still publishes',
  CC.isDosePublishable(prop, prop.doses[0]) === true);
t('a dose on an unpublishable drug never publishes',
  CC.isDosePublishable(CC.byId('drug.sevoflurane'), { evidence:{ state:'reviewed',
    authority:'x', documentId:'y', section:'z' } }) === false);
t('proposed-unverified at dose level does not publish',
  CC.isDosePublishable(prop, { evidence:{ state:'proposed-unverified' } }) === false);
t('REVIEWED WITHOUT A CITATION DOES NOT PUBLISH',
  CC.isDosePublishable(prop, { evidence:{ state:'reviewed', authority:'DailyMed' } }) === false);
t('...missing section alone is enough to refuse it',
  CC.isDosePublishable(prop, { evidence:{ state:'reviewed', authority:'a', documentId:'b' } }) === false);
t('a fully cited reviewed dose publishes',
  CC.isDosePublishable(prop, { evidence:{ state:'reviewed', authority:'a',
    documentId:'b', section:'c' } }) === true);
t('the drug-level gate is untouched: still exactly 25 publishable drugs',
  CC.DRUGS.filter(CC.isPublishable).length === 25);

/* ── DOSE ENUMERATION AND THE WITHHELD ROW ──────────────────────────────*/
console.log('\n13. ENUMERATION AND WITHHOLDING');

/* ENUMERATION IS NO LONGER INERT, WHICH IS THE POINT. Three drugs now carry
   more than one dose, so the old parity with visibleDrugsInGroup is gone by
   design — and the difference is exactly the extra records, never a lost one. */
t('every drug visibleDrugsInGroup returns still appears in visibleDosesInGroup',
  CC.GROUPS.every(g => [null, 3.4, 16, 75, 120].every(w => {
    const enumerated = CC.visibleDosesInGroup(g.id, w, null).map(r => r.id);
    return CC.visibleDrugsInGroup(g.id, w).every(r => enumerated.indexOf(r.id) >= 0);
  })), 'enumeration adds rows, it never drops a drug');
t('...and the drugs carrying more than one are exactly the migrated ones',
  CC.DRUGS.filter(d => (d.doses||[]).length > 1).map(d => d.id).sort().join(',') ===
  'drug.fentanyl,drug.ketamine,drug.propofol,drug.remifentanil,drug.rocuronium',
  CC.DRUGS.filter(d => (d.doses||[]).length > 1).map(d => d.id));
t('the classified records are exactly the ones this migration touched',
  CC.DRUGS.filter(d => (d.doses||[]).some(x => x.populationClass)).map(d => d.id).sort().join(',') ===
  'drug.fentanyl,drug.ketamine,drug.propofol,drug.remifentanil,drug.rocuronium,drug.suxamethonium');
t('ageBand appears only on class-C records',
  CC.DRUGS.every(d => (d.doses||[]).every(x => !x.ageBand || x.populationClass === 'C')));
t('dose-level evidence appears only where a record was classified',
  CC.DRUGS.every(d => (d.doses||[]).every(x => !x.evidence || !!x.populationClass)));
/* The shared ADULT fixture carries no ASA, and propofol's reviewed adult
   record requires one — so it is withheld for that fixture, correctly and by
   design. The assertion uses an adult with an ASA, and the no-ASA case is
   asserted separately as the ASA coverage state rather than folded in here. */
const ADULT_ASA = P(false, yrs(44), 'II');
t('withheld rows now appear for a child, and never for a fully-specified adult',
  ['induction','analgesia','nmb'].some(g =>
    CC.visibleDosesInGroup(g, 15, CHILD).some(r => r.withheld)) &&
  ['induction','analgesia','nmb','reversal'].every(g =>
    CC.visibleDosesInGroup(g, 70, ADULT_ASA).every(r => !r.withheld)),
  ['induction','analgesia','nmb','reversal'].flatMap(g =>
    CC.visibleDosesInGroup(g, 70, ADULT_ASA).filter(r => r.withheld).map(r => g+':'+r.name)));
t('...and an adult with no ASA is told which field would answer it',
  CC.visibleDosesInGroup('induction', 70, ADULT)
    .filter(r => r.id === 'drug.propofol')
    .every(r => r.withheld && r.coverage === 'ASA required to match reviewed dose'));

/* The withheld row itself: a drug, and provably not a dose. */
const wr = CC.visibleDosesInGroup('induction', 16,
  CHILD, null).length && (function(){
    /* build one directly through the public rule, since no record triggers it */
    const fake = { id:'drug.propofol', name:'Propofol', klass:'k', aliases:['propofol','diprivan'],
                   prep:'<b>1% = 10 mg/mL</b> · note', warn:'w', severity:'caution', pclass:'induction' };
    return CC.doseEligibility({ populationClass:'A' }, CHILD);
  })();
t('an A-class dose against a child yields the paediatric coverage wording',
  CC.COVERAGE[CC.WITHHELD.PAEDIATRIC] === 'Pediatric dose not reviewed');
t('an age-band gap yields the age wording',
  CC.COVERAGE[CC.WITHHELD.AGE] === 'No reviewed dose for this age');
t('a B-class dose against an adult yields the adult wording',
  CC.COVERAGE[CC.WITHHELD.ADULT] === 'Adult dose not reviewed');
t('NO COVERAGE STATE MAKES A CLINICAL CLAIM',
  Object.values(CC.COVERAGE).every(s =>
    !/contraindicat|not recommended|unavailable|unsafe|do not (use|give)/i.test(s)),
  Object.values(CC.COVERAGE));

/* ── THE WITHHELD ROW, EXERCISED END TO END ─────────────────────────────
   No shipped record is classified yet, so this drives visibleDosesInGroup()
   over a synthetic dataset with the real functions. It is the only way to see
   the state the clinical migration will produce before it produces it.      */
console.log('\n13b. DRUG VISIBLE, DOSE WITHHELD');

const synth = (doses) => ({
  id:'drug.synthetic', name:'Synthetic', group:'induction', pclass:'induction',
  klass:'Test hypnotic', aliases:['synthetic','tradename','second'],
  indications:['induction'], doses:doses,
  prep:'<b>10 mg/mL</b> · 1.2 mg/kg for RSI', warn:'A drug-level caution.',
  severity:'caution', provenance:{ state:'existing-unchanged' }
});
const ADULT_ONLY = { label:'Induction', route:'IV', phase:'induction', low:2, high:2.5,
  unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range', populationClass:'A' };
const PAED_ONLY  = { label:'Induction', route:'IV', phase:'induction', low:2.5, high:3.5,
  unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range', populationClass:'B' };

/* Splice the synthetic drug in, run the real selector, take it out again. */
function withSynth(doses, fn){
  const d = synth(doses);
  CC.DRUGS.push(d);
  try { return fn(d); } finally { CC.DRUGS.splice(CC.DRUGS.indexOf(d), 1); }
}

/* A — adult-only record, paediatric patient */
withSynth([ADULT_ONLY], () => {
  const rows = CC.visibleDosesInGroup('induction', 16, CHILD).filter(r => r.id === 'drug.synthetic');
  t('A: the drug is still in the group for a child', rows.length === 1);
  t('A: ...the tile keeps its name, class colour and badge',
    rows[0] && rows[0].name === 'Synthetic' && rows[0].pclass === 'induction' && !!rows[0].badge);
  t('A: ...and its aliases and vial concentration',
    rows[0] && rows[0].aliasLine === 'tradename, second' && rows[0].prepMain === '10 mg/mL');
  t('A: ...the row is marked withheld with the paediatric wording',
    rows[0] && rows[0].withheld === true && rows[0].coverage === 'Pediatric dose not reviewed');
  /* K — NOTHING NUMERIC SURVIVES */
  t('K: no low, high, value or computed amount anywhere on the row',
    rows[0] && ['val','unit','doseRule','doseNum','doseUnit','ind','use','duration']
      .every(f => rows[0][f] === '') &&
    rows[0].low === undefined && rows[0].high === undefined && rows[0].value === undefined,
    Object.keys(rows[0]).filter(k => /^(low|high|value)$/.test(k)));
  t('K: ...and no scaled adult number appears in any field',
    rows[0] && !JSON.stringify(rows[0]).match(/\b(32|40|2\.5|2-2\.5)\b/),
    '2-2.5 mg/kg x 16 kg = 32-40 mg must not exist');
  t('K: ...and the prose half of prep, which hides a dose, is dropped',
    rows[0] && rows[0].prepNote === '' && !/1\.2 mg\/kg/.test(JSON.stringify(rows[0])));
  /* An adult still gets the number. */
  const ad = CC.visibleDosesInGroup('induction', 75, ADULT).filter(r => r.id === 'drug.synthetic');
  t('A: the same record renders normally for an adult',
    ad[0] && !ad[0].withheld && ad[0].val === '150–188', ad[0] && ad[0].val);
});

/* B — paediatric-only record, adult patient */
withSynth([PAED_ONLY], () => {
  const rows = CC.visibleDosesInGroup('induction', 75, ADULT).filter(r => r.id === 'drug.synthetic');
  t('B: the drug is still visible for an adult', rows.length === 1 && rows[0].withheld === true);
  t('B: ...with the adult wording', rows[0].coverage === 'Adult dose not reviewed');
  t('B: ...and a child still gets the number',
    CC.visibleDosesInGroup('induction', 16, CHILD)
      .filter(r => r.id === 'drug.synthetic')[0].val === '40–56');
});

/* L — every dose withheld, drug still present exactly once */
withSynth([ADULT_ONLY, { ...ADULT_ONLY, label:'Second adult record', route:'IM' }], () => {
  const rows = CC.visibleDosesInGroup('induction', 16, CHILD).filter(r => r.id === 'drug.synthetic');
  t('L: two withheld doses collapse to ONE tile, not two, and not zero',
    rows.length === 1 && rows[0].withheld === true);
});

/* N — multiple routes enumerate independently when both are eligible */
withSynth([ADULT_ONLY, { ...ADULT_ONLY, label:'Induction', route:'IM', low:6.5, high:13 }], () => {
  const rows = CC.visibleDosesInGroup('induction', 75, ADULT).filter(r => r.id === 'drug.synthetic');
  t('N: two routes on one drug produce TWO rows', rows.length === 2, rows.map(r => r.use));
  t('N: ...each carrying its own route and its own dose',
    rows[0].use === 'IV · Induction' && rows[1].use === 'IM · Induction' &&
    rows[0].val !== rows[1].val, rows.map(r => r.use + ' = ' + r.val));
});

/* One eligible and one withheld: the eligible row wins, no coverage line. */
withSynth([ADULT_ONLY, PAED_ONLY], () => {
  const kid = CC.visibleDosesInGroup('induction', 16, CHILD).filter(r => r.id === 'drug.synthetic');
  t('a drug with both records shows the eligible one and no coverage line',
    kid.length === 1 && !kid[0].withheld && kid[0].val === '40–56', kid[0] && kid[0].val);
  t('...and the adult-only record is not rendered alongside it',
    kid.every(r => r.val !== '32–40'),
    'the transition hazard: reviewed paediatric + legacy adult must not co-render');
});

/* M — no phase fallback, through the enumerating selector */
withSynth([{ ...ADULT_ONLY, phase:'intubation' }], () => {
  t('M: asking for RSI on a drug with only an intubating dose returns NOTHING',
    CC.visibleDosesInGroup('induction', 75, ADULT, 'rsi')
      .filter(r => r.id === 'drug.synthetic').length === 0);
  t('M: ...while the intubation phase still finds it',
    CC.visibleDosesInGroup('induction', 75, ADULT, 'intubation')
      .filter(r => r.id === 'drug.synthetic').length === 1);
  t('M: ...and no withheld row is invented for a phase the drug has no dose in',
    CC.visibleDosesInGroup('induction', 75, ADULT, 'rsi').every(r => !r.withheld));
});

t('the synthetic drug left no trace in the dataset',
  CC.DRUGS.length === 30 && !CC.byId('drug.synthetic'));

/* ── THE RENDERERS CANNOT PRODUCE A NUMBER FOR A WITHHELD DOSE ──────────*/
console.log('\n14. NO NUMBER SURVIVES A WITHHELD DOSE');

/* withheldRowFor is reached through visibleDosesInGroup only, so this asserts
   the source: the function must not reference renderDose at all. */
const WRF = /function withheldRowFor\(([\s\S]*?)\n}/.exec(IDX);
t('withheldRowFor exists', !!WRF);
t('...and never calls renderDose', WRF && !/renderDose/.test(WRF[1]));
t('...and never multiplies by a weight', WRF && !/\*\s*wt|wt\s*\*/.test(WRF[1]));
t('...and takes no weight argument at all',
  /function withheldRowFor\(d, reason\)/.test(IDX));

/* The three UI entry points must hand the model a population, not just a kg. */
t('the drug reference passes a population',   /visibleDosesInGroup\(gid, wt, pop\)/.test(ENGC));
t('the workflow panels pass a population',    /visibleDosesInGroup\(g\.id, weight, pop\)/.test(ENGC));
t('the induction workstation passes a population',
  /visibleDosesInGroup\(groupId, weight\(\), population\(\)\)/.test(code(read('induction.js'))));
t('no render path still reads doses[0]',
  !/doses\s*&&\s*src\.doses\[0\]/.test(ENGC) && !/\.doses\[0\]/.test(code(read('induction.js'))));

/* ── THE LEVER IS DECLARED, AND ITS CURRENT VALUE IS STATED ─────────────*/
/* ── LEGACY COMPATIBILITY: ADMISSION WITHOUT A CLAIM ─────────────────────
   THREE THINGS, AND THEY MUST NOT COLLAPSE INTO ONE:
     population       metadata — "entered as adult"
     populationClass  EVIDENCE — "a reviewed source establishes this"
     eligibility      whether THIS patient may see THIS dose

   An earlier cut derived class A from population 'adult'. That made an
   unreviewed record report itself as source-backed, and every later question
   about what is reviewed would have got the wrong answer. Metadata may decide
   eligibility; it may never become evidence. */
console.log('\n14b. LEGACY COMPATIBILITY');

const legacyAdultDrug = { provenance:{ state:'existing-unchanged' } };
const legacyAdultDose = { population:'adult' };
const legacyPaedDose  = { population:'paediatric' };
const elg = (dose, pop, drug) => CC.doseEligibility(dose, pop, drug || legacyAdultDrug);

t('1  legacy existing-unchanged adult record, adult patient → ELIGIBLE',
  elg(legacyAdultDose, ADULT).eligible === true);
t('2  ...the same record, paediatric patient → WITHHELD',
  elg(legacyAdultDose, CHILD).eligible === false &&
  elg(legacyAdultDose, CHILD).reason === CC.WITHHELD.PAEDIATRIC);
t('3  legacy paediatric record, child → ELIGIBLE',
  elg(legacyPaedDose, CHILD).eligible === true);
t('4  ...the same record, adult → WITHHELD',
  elg(legacyPaedDose, ADULT).eligible === false &&
  elg(legacyPaedDose, ADULT).reason === CC.WITHHELD.ADULT);
t('5  unclassified record with NO explicit population → WITHHELD for everyone',
  elg({}, ADULT).eligible === false && elg({}, CHILD).eligible === false &&
  elg({ population:'unspecified' }, ADULT).eligible === false);
t('...and an unclassified record on a NON-legacy drug is withheld too',
  CC.doseEligibility(legacyAdultDose, ADULT,
    { provenance:{ state:'proposed-unverified' } }).eligible === false,
  'compatibility is for shipped records, not a general escape hatch');

/* 6–10: the reviewed classes are unaffected by any of the above. */
t('6  reviewed class A → adult only',
  elg({ populationClass:'A' }, ADULT).eligible && !elg({ populationClass:'A' }, CHILD).eligible);
t('7  reviewed class B → paediatric only',
  elg({ populationClass:'B' }, CHILD).eligible && !elg({ populationClass:'B' }, ADULT).eligible);
t('8  reviewed class C → the exact band, and nothing outside it', (() => {
  const d = { populationClass:'C',
    ageBand:{ min:{ value:3, unit:'years', inclusive:true },
              max:{ value:16, unit:'years', inclusive:true } } };
  return elg(d, P(true, yrs(3))).eligible && elg(d, P(true, yrs(16.9))).eligible &&
         !elg(d, P(true, yrs(2))).eligible && !elg(d, P(true, yrs(17))).eligible &&
         !elg(d, ADULT).eligible;
})());
t('9  reviewed class D → both populations, one record',
  elg({ populationClass:'D' }, ADULT).eligible && elg({ populationClass:'D' }, CHILD).eligible);
t('10 class E → never renders, for anyone',
  !elg({ populationClass:'E' }, ADULT).eligible &&
  !elg({ populationClass:'E' }, CHILD).eligible &&
  !elg({ populationClass:'E' }, null).eligible);

/* 11–13: the compatibility layer writes nothing back, ever. */
const beforeLegacy = JSON.stringify(CC.DRUGS.map(d =>
  (d.doses||[]).map(x => [x.populationClass, x.population, x.evidence && x.evidence.state])));
['induction','analgesia','nmb','reversal'].forEach(g =>
  [ADULT, CHILD, BABY, NOAGE].forEach(p => CC.visibleDosesInGroup(g, 70, p)));
t('11 legacy compatibility does NOT populate or mutate populationClass',
  JSON.stringify(CC.DRUGS.map(d =>
    (d.doses||[]).map(x => [x.populationClass, x.population, x.evidence && x.evidence.state])))
    === beforeLegacy,
  'the dataset is byte-identical after every eligibility call');
t('...and exactly 11 doses carry a populationClass — the reviewed ones',
  CC.DRUGS.reduce((a,d) => a + (d.doses||[]).filter(x => x.populationClass).length, 0) === 11);
t('12 legacy compatibility does NOT change provenance.state',
  CC.DRUGS.filter(CC.isPublishable).every(d => d.provenance.state === 'existing-unchanged'));
t('13 NO existing-unchanged record became reviewed',
  CC.DRUGS.every(d => (d.doses||[]).every(x =>
    !x.evidence || x.evidence.state !== 'reviewed' || !!x.populationClass)) &&
  CC.DRUGS.reduce((a,d) => a + (d.doses||[])
    .filter(x => x.evidence && x.evidence.state === 'reviewed').length, 0) === 11);
t('...and dose-level evidence exists ONLY on the 11 reviewed records',
  CC.DRUGS.reduce((a,d) => a + (d.doses||[]).filter(x => x.evidence).length, 0) === 11);

/* THE NAMED HELD RECORDS, EXERCISED THROUGH THE REAL SELECTOR. */
[['drug.midazolam','induction'], ['drug.dexmedetomidine','induction'],
 ['drug.morphine','analgesia'], ['drug.remifentanil','analgesia']].forEach(([id, g]) => {
  const nm = CC.byId(id).name;
  t('  ' + nm.padEnd(18) + ' adult → renders under legacy compatibility',
    CC.visibleDosesInGroup(g, 70, ADULT).some(r => r.id === id && !r.withheld));
  t('  ' + nm.padEnd(18) + ' child → withheld, no number',
    CC.visibleDosesInGroup(g, 15, CHILD).filter(r => r.id === id)
      .every(r => r.withheld && r.val === ''));
  /* Remifentanil also holds two REVIEWED records, which carry a class
     legitimately. What must carry none is the legacy dose — the one with no
     evidence block behind it. */
  t('  ' + nm.padEnd(18) + ' ...and its legacy dose carries no fabricated class',
    (CC.byId(id).doses||[]).filter(x => !x.evidence)
      .every(x => x.populationClass === undefined));
});
t('the reversal group still renders in full for an adult',
  CC.visibleDosesInGroup('reversal', 70, ADULT).length === 3 &&
  CC.visibleDosesInGroup('reversal', 70, ADULT).every(r => !r.withheld));
t('...and is withheld in full from a child, with no class invented',
  CC.visibleDosesInGroup('reversal', 15, CHILD).every(r => r.withheld) &&
  ['drug.sugammadex','drug.sugammadex-immediate','drug.neostigmine'].every(id =>
    (CC.byId(id).doses||[]).every(x => x.populationClass === undefined)));

/* ── THE TIER 1 MIGRATION ────────────────────────────────────────────────*/
console.log('\n15. TIER 1 REVIEWED RECORDS');

const reviewed = [];
CC.DRUGS.forEach(d => (d.doses||[]).forEach(x => {
  if (x.evidence && x.evidence.state === 'reviewed') reviewed.push({ id:d.id, dose:x });
}));
t('EXACTLY 11 REVIEWED DOSE RECORDS', reviewed.length === 11, reviewed.length);
t('...every one carries a full citation',
  reviewed.every(r => r.dose.evidence.authority && r.dose.evidence.title &&
                      r.dose.evidence.documentId && r.dose.evidence.section));
t('...every one declares a population and a class',
  reviewed.every(r => r.dose.population && r.dose.populationClass));
t('...every one declares a phase and a route',
  reviewed.every(r => r.dose.phase && r.dose.route));
t('...and every class-C record carries a band, every non-C none',
  reviewed.every(r => (r.dose.populationClass === 'C') === !!r.dose.ageBand));

const dose = (id, pred) => (CC.byId(id).doses||[]).filter(pred)[0];
const byLabel = (id, label, route) => (CC.byId(id).doses||[])
  .filter(x => x.label === label && (!route || x.route === route))[0];

/* PROPOFOL */
const pA = byLabel('drug.propofol','Induction','IV');
t('propofol adult: 2–2.5 mg/kg, class A', pA.low === 2 && pA.high === 2.5 && pA.populationClass === 'A');
t('propofol adult: qualified <65 and ASA I–II',
  pA.applicability.ageBand.max.value === 65 &&
  pA.applicability.ageBand.max.inclusive === false &&
  pA.applicability.asa.join('') === 'III');
t('propofol adult: the shipped 1.5–2.5 is gone, not kept alongside',
  !(CC.byId('drug.propofol').doses||[]).some(x => x.low === 1.5));
const pP = (CC.byId('drug.propofol').doses||[])[1];
t('propofol paediatric: 2.5–3.5 mg/kg, class C, 3 through 16 years',
  pP.low === 2.5 && pP.high === 3.5 && pP.populationClass === 'C' &&
  pP.ageBand.min.value === 3 && pP.ageBand.min.inclusive === true &&
  pP.ageBand.max.value === 16 && pP.ageBand.max.inclusive === true);
t('propofol: adult and paediatric cite DIFFERENT documents',
  pA.evidence.documentId !== pP.evidence.documentId,
  [pA.evidence.documentId, pP.evidence.documentId]);

const elig = (id, i, pop) => CC.doseEligibility(CC.byId(id).doses[i], pop);
t('propofol adult 44y ASA II  → eligible',   elig('drug.propofol',0,P(false,yrs(44),'II')).eligible);
t('propofol adult 70y ASA II  → WITHHELD',  !elig('drug.propofol',0,P(false,yrs(70),'II')).eligible);
t('propofol adult ASA III     → WITHHELD',  !elig('drug.propofol',0,P(false,yrs(44),'III')).eligible);
t('propofol adult ASA unknown → WITHHELD, and says which field',
  elig('drug.propofol',0,P(false,yrs(44),null)).reason === CC.WITHHELD.ASA);
t('propofol child 2y  → WITHHELD (outside the band)',
  !elig('drug.propofol',1,P(true,yrs(2),'II')).eligible &&
  elig('drug.propofol',1,P(true,yrs(2),'II')).reason === CC.WITHHELD.AGE);
t('propofol child 3y     → eligible',    elig('drug.propofol',1,P(true,yrs(3),'II')).eligible);
t('propofol child 16.9y  → eligible',    elig('drug.propofol',1,P(true,yrs(16.9),'II')).eligible);
t('propofol child 17y    → WITHHELD',   !elig('drug.propofol',1,P(true,yrs(17),'II')).eligible);
t('propofol child ASA III → WITHHELD',  !elig('drug.propofol',1,P(true,yrs(5),'III')).eligible);

/* FENTANYL */
const fRows = (w,pop) => CC.visibleDosesInGroup('analgesia', w, pop).filter(r => r.id === 'drug.fentanyl');
t('fentanyl child 3y: exactly one row, the reviewed 2–3 mcg/kg',
  fRows(15,CHILD).length === 1 && fRows(15,CHILD)[0].doseNum === '2–3',
  fRows(15,CHILD).map(r => r.doseNum));
t('fentanyl: THE LEGACY ADULT 1–3 NEVER CO-RENDERS FOR A CHILD',
  !fRows(15,CHILD).some(r => r.doseNum === '1–3'));
t('fentanyl adult: still sees the legacy adult record',
  fRows(70,ADULT).some(r => r.doseNum === '1–3'));
/* NEITHER CLASSIFIED NOR CERTIFIED. The legacy adult record keeps exactly
   the shape it shipped with: a population, and nothing else. It is kept out
   of children by the compatibility rule, not by a class it did not earn. */
t('fentanyl adult record is neither classified nor certified',
  CC.byId('drug.fentanyl').doses[0].populationClass === undefined &&
  CC.byId('drug.fentanyl').doses[0].evidence === undefined &&
  CC.byId('drug.fentanyl').doses[0].population === 'adult' &&
  CC.byId('drug.fentanyl').doses[0].phase === undefined);
t('...and its value is untouched',
  CC.byId('drug.fentanyl').doses[0].low === 1 &&
  CC.byId('drug.fentanyl').doses[0].high === 3);

/* ROCURONIUM */
const rocR = CC.byId('drug.rocuronium');
t('rocuronium: three records — adult intubation, paed intubation, adult RSI',
  rocR.doses.length === 3 &&
  rocR.doses[0].phase === 'intubation' && rocR.doses[0].populationClass === 'A' &&
  rocR.doses[1].phase === 'intubation' && rocR.doses[1].populationClass === 'B' &&
  rocR.doses[2].phase === 'rsi'        && rocR.doses[2].populationClass === 'A');
t('rocuronium adult intubation is 0.6, not the old 0.6–1.2',
  rocR.doses[0].value === 0.6 && rocR.doses[0].low === undefined);
t('rocuronium RSI is 0.6–1.2', rocR.doses[2].low === 0.6 && rocR.doses[2].high === 1.2);
t('rocuronium adult, phase intubation → only the 0.6 record',
  CC.visibleDosesInGroup('nmb',70,ADULT,'intubation')
    .filter(r => r.id === 'drug.rocuronium').map(r => r.doseNum).join('|') === '0.6');
t('rocuronium adult, phase rsi → only the 0.6–1.2 record',
  CC.visibleDosesInGroup('nmb',70,ADULT,'rsi')
    .filter(r => r.id === 'drug.rocuronium').map(r => r.doseNum).join('|') === '0.6–1.2');
t('rocuronium child, phase intubation → only the paediatric record',
  CC.visibleDosesInGroup('nmb',15,CHILD,'intubation')
    .filter(r => r.id === 'drug.rocuronium' && !r.withheld).length === 1);
t('rocuronium child, phase rsi → NO number, no adult substitute',
  CC.visibleDosesInGroup('nmb',15,CHILD,'rsi')
    .filter(r => r.id === 'drug.rocuronium' && !r.withheld).length === 0);
t('DEFECT B CLOSED: prep carries no dose',
  rocR.prep === '<b>10 mg/mL</b>' && !/mg\/kg/.test(rocR.prep), rocR.prep);

/* SUXAMETHONIUM */
const sux = CC.byId('drug.suxamethonium');
t('suxamethonium adult: reviewed 0.3–1.1, one record only',
  sux.doses.length === 1 && sux.doses[0].low === 0.3 && sux.doses[0].high === 1.1);
t('...the shipped 1–1.5 "RSI" is gone',
  !sux.doses.some(x => x.low === 1 && x.high === 1.5) &&
  !sux.doses.some(x => x.label === 'RSI'));
t('...no paediatric record was invented',
  !sux.doses.some(x => x.population === 'paediatric'));
t('...and no IM route was added', !sux.doses.some(x => x.route === 'IM'));
t('suxamethonium child → withheld, no number',
  CC.visibleDosesInGroup('nmb',15,CHILD).filter(r => r.id === 'drug.suxamethonium')
    .every(r => r.withheld && r.val === ''));

/* REMIFENTANIL */
const remiR = CC.byId('drug.remifentanil');
t('remifentanil: legacy + infusion + bolus = three records', remiR.doses.length === 3);
t('remifentanil adult induction infusion is 0.5–1 mcg/kg/min',
  remiR.doses[1].low === 0.5 && remiR.doses[1].high === 1 && remiR.doses[1].unit === 'mcg/kg/min');
t('...and the bolus is a SEPARATE record, in mcg/kg not a rate',
  remiR.doses[2].value === 1 && remiR.doses[2].unit === 'mcg/kg' && remiR.doses[2].basisWeight === true);
t('THE LEGACY 0.05–0.2 DOES NOT ANSWER phase:induction',
  CC.dosesForPhase(remiR,'induction').every(x => !(x.low === 0.05 && x.high === 0.2)) &&
  CC.dosesForPhase(remiR,'induction').length === 2);
t('...because it declares no phase at all', remiR.doses[0].phase === undefined);
t('remifentanil child → withheld, no adult induction value',
  CC.visibleDosesInGroup('analgesia',15,CHILD).filter(r => r.id === 'drug.remifentanil')
    .every(r => r.withheld));

/* KETAMINE */
const ket = CC.byId('drug.ketamine');
t('ketamine: IV and IM enumerate as two records', ket.doses.length === 2 &&
  ket.doses[0].route === 'IV' && ket.doses[1].route === 'IM');
t('ketamine IV is 1–4.5', ket.doses[0].low === 1 && ket.doses[0].high === 4.5);
t('ketamine IM is 6.5–13', ket.doses[1].low === 6.5 && ket.doses[1].high === 13);
t('...the shipped 1–2 is gone', !ket.doses.some(x => x.low === 1 && x.high === 2));
t('ketamine adult: two separate rows, two different amounts',
  (() => { const r = CC.visibleDosesInGroup('induction',70,ADULT).filter(x => x.id === 'drug.ketamine');
           return r.length === 2 && r[0].val !== r[1].val; })());
t('ketamine child → withheld, no number (8.4: not established below 16)',
  CC.visibleDosesInGroup('induction',15,CHILD).filter(r => r.id === 'drug.ketamine')
    .every(r => r.withheld && r.val === ''));

/* HELD DRUGS UNTOUCHED */
console.log('\n16. HELD DRUGS UNTOUCHED');
const midazH = CC.byId('drug.midazolam'), dexH = CC.byId('drug.dexmedetomidine');
t('midazolam: one dose, unchanged, no class, no phase, no evidence block',
  midazH.doses.length === 1 && midazH.doses[0].low === 0.02 && midazH.doses[0].high === 0.04 &&
  midazH.doses[0].populationClass === undefined && midazH.doses[0].phase === undefined &&
  midazH.doses[0].evidence === undefined);
t('...and it is still withheld from a child by the derived class',
  CC.visibleDosesInGroup('induction',15,CHILD).filter(r => r.id === 'drug.midazolam')
    .every(r => r.withheld));
t('...while an adult still sees it',
  CC.visibleDosesInGroup('induction',70,ADULT).filter(r => r.id === 'drug.midazolam')
    .every(r => !r.withheld));
t('dexmedetomidine: dose, pclass and provenance all unchanged',
  dexH.doses.length === 1 && dexH.doses[0].low === 0.2 && dexH.doses[0].high === 0.7 &&
  dexH.pclass === 'induction' && dexH.doses[0].populationClass === undefined);
t('sevoflurane still proposed-unverified with no dose',
  CC.byId('drug.sevoflurane').doses.length === 0 &&
  CC.byId('drug.sevoflurane').provenance.state === 'proposed-unverified');
t('reversal drugs still render for an adult',
  CC.visibleDosesInGroup('reversal',70,ADULT).every(r => !r.withheld));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
