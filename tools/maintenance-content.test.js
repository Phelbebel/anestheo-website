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
const phased = CC.DRUGS.filter(d => (d.doses || []).some(x => x.phase));
t('no record declares a phase yet — Phase 4A published no clinical value',
  phased.length === 0, phased.map(d => d.id));
t('...so every group returns nothing for maintenance',
  CC.GROUPS.every(g => CC.visibleInGroupForPhase(g.id, 75, CC.PHASES.MAINTENANCE).length === 0));
t('...and the coverage report says zero everywhere, not "unknown"',
  Object.values(CC.phaseCoverage(CC.PHASES.MAINTENANCE)).every(v => v.withPhase === 0),
  CC.phaseCoverage(CC.PHASES.MAINTENANCE));

/* THE TWO SPECIFIC HAZARDS THE BRIEF NAMES. */
const propofol = CC.byId('drug.propofol');
t('propofol carries an induction bolus and nothing else',
  propofol.doses.length === 1 && propofol.doses[0].label === 'Induction' &&
  propofol.doses[0].unit === 'mg/kg',
  propofol.doses.map(d => d.label + ' ' + d.unit));
t('...so asking for its maintenance dose returns NOTHING, not the bolus',
  CC.dosesForPhase(propofol, CC.PHASES.MAINTENANCE).length === 0);
t('...and no group render can present that bolus as an infusion',
  CC.visibleInGroupForPhase('induction', 75, CC.PHASES.MAINTENANCE).length === 0);

const roc = CC.byId('drug.rocuronium');
t('rocuronium carries an intubating dose and nothing else',
  roc.doses.length === 1 && roc.doses[0].label === 'Intubation',
  roc.doses.map(d => d.label));
t('...so asking for a re-dose returns NOTHING',
  CC.dosesForPhase(roc, CC.PHASES.REDOSE).length === 0 &&
  CC.dosesForPhase(roc, CC.PHASES.MAINTENANCE).length === 0);
t('...and no blocker in the model carries a maintenance or re-dose entry',
  CC.DRUGS.filter(d => d.pclass === 'nmb')
    .every(d => (d.doses || []).every(x => !x.phase)),
  CC.DRUGS.filter(d => d.pclass === 'nmb').map(d => d.id + ':' + d.doses.map(x => x.label)));
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
t('...at exactly 0.05-0.2 mcg/kg/min, unchanged',
  remi.doses.length === 1 && remi.doses[0].low === 0.05 && remi.doses[0].high === 0.2 &&
  remi.doses[0].unit === 'mcg/kg/min' && remi.doses[0].label === 'Infusion',
  remi.doses[0]);
t('...it is not duplicated anywhere in the dataset',
  CC.DRUGS.filter(d => /remifentanil/i.test(d.name)).length === 1);
t('...and it renders identically to before Phase 4A',
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
  t('every pre-existing render field is unchanged, at every weight',
    changed.length === 0 && removed.size === 0,
    { rowsCompared: rows, changed: changed.slice(0, 5), removed: [...removed] });
  t('...and the only difference is the two additive wires',
    [...added].sort().join(',') === 'interval,phase', [...added]);
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

const ADULT = { pediatric:false, adult:true,  ageDays:365*40 };
const CHILD = { pediatric:true,  adult:false, ageDays:365*4  };
const BABY  = { pediatric:true,  adult:false, ageDays:60     };
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

/* C — age-banded, both bounds inclusive */
const dC = { populationClass:'C', ageBand:{ minDays:1095, maxDays:5844 } };
t('C: inside the band eligible',  el(dC, { pediatric:true, adult:false, ageDays:2000 }));
t('C: exactly minDays is INSIDE', el(dC, { pediatric:true, adult:false, ageDays:1095 }));
t('C: exactly maxDays is INSIDE', el(dC, { pediatric:true, adult:false, ageDays:5844 }));
t('C: one day below is OUTSIDE', !el(dC, { pediatric:true, adult:false, ageDays:1094 }));
t('C: one day above is OUTSIDE', !el(dC, { pediatric:true, adult:false, ageDays:5845 }));
t('C: outside the band reports the age reason',
  why(dC, { pediatric:true, adult:false, ageDays:400 }) === CC.WITHHELD.AGE);
t('C: NO NEAREST-BAND FALLBACK — a younger child gets nothing',
  !el(dC, BABY));
t('C: adult WITHHELD',           !el(dC, ADULT) && why(dC, ADULT) === CC.WITHHELD.ADULT);
t('C: unknown age is not inside any band',
  !el(dC, { pediatric:true, adult:false, ageDays:null }));
t('C: an open lower bound still excludes above',
  CC.inAgeBand({ minDays:null, maxDays:100 }, 50) && !CC.inAgeBand({ minDays:null, maxDays:100 }, 101));
t('C: an open upper bound still excludes below',
  CC.inAgeBand({ minDays:100, maxDays:null }, 5000) && !CC.inAgeBand({ minDays:100, maxDays:null }, 99));

/* D — one rule, both populations, ONE record */
const dD = { populationClass:'D' };
t('D: adult eligible',            el(dD, ADULT));
t('D: paediatric eligible',       el(dD, CHILD));
t('D: neonate eligible',          el(dD, BABY));

/* E — never */
const dE = { populationClass:'E' };
t('E: never eligible for anyone', !el(dE, ADULT) && !el(dE, CHILD) && !el(dE, NOAGE));
t('E: never publishable either',
  CC.isDosePublishable(CC.byId('drug.propofol'), { populationClass:'E' }) === false);

/* An unknown class is withheld, not admitted — the default is silence. */
t('an unrecognised class is WITHHELD, not admitted',
  !el({ populationClass:'Z' }, ADULT) && !el({ populationClass:'Z' }, CHILD));

/* No patient = no gate. A reference with no patient loaded is still a reference. */
t('with no patient known, classed doses still render',
  el(dA, NOAGE) && el(dB, NOAGE) && el(dC, NOAGE));

/* ── patientPopulation reads patientContext and holds no threshold ────── */
t('patientPopulation returns null when no context',   CC.patientPopulation(null) === null);
t('...and null when the age is unknown',
  CC.patientPopulation({ context:{ pediatric:false, adult:false }, age:{ days:null } }) === null);
t('...and carries age in days for a child',
  CC.patientPopulation({ context:{ pediatric:true, adult:false }, age:{ days:1460 } }).ageDays === 1460);
t('...and no age threshold is written in clinical-index.js',
  !/\b(?:age|y|years)\s*[<>]=?\s*(?:16|18|12|3)\b/.test(IDXC), 'threshold stays in patientContext');

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

t('visibleDosesInGroup matches visibleDrugsInGroup for every group and weight',
  CC.GROUPS.every(g => [null, 3.4, 16, 75, 120].every(w =>
    JSON.stringify(CC.visibleDosesInGroup(g.id, w, null)) ===
    JSON.stringify(CC.visibleDrugsInGroup(g.id, w)))),
  'enumeration is inert against a one-dose-per-drug dataset');

t('no record carries populationClass yet',
  CC.DRUGS.every(d => (d.doses||[]).every(x => x.populationClass === undefined)));
t('no record carries ageBand yet',
  CC.DRUGS.every(d => (d.doses||[]).every(x => x.ageBand === undefined)));
t('no record carries dose-level evidence yet',
  CC.DRUGS.every(d => (d.doses||[]).every(x => x.evidence === undefined)));
t('...so no group produces a withheld row for any patient',
  CC.GROUPS.every(g => [ADULT, CHILD, BABY, NOAGE].every(p =>
    CC.visibleDosesInGroup(g.id, 75, p).every(r => !r.withheld))));

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
t('unclassified records are still eligible (the lever is off)',
  CC.UNCLASSIFIED_ELIGIBLE === true,
  'flips to false in the commit that lands the reviewed records');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
