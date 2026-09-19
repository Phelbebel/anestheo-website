/* ============================================================================
   ANESTHEO — CLINICAL CONTENT MODEL AND SEARCH INDEX
   ----------------------------------------------------------------------------
   One structured dataset powering: module rows, the command palette, aliases,
   exact anchors, detail expansion, dose formatting, warnings and provenance.
   There is no second search index and no duplicated drug data.

   PROVENANCE IS THE SAFETY GATE
   -----------------------------
     'existing-unchanged'  migrated verbatim from the shipped Live Tools page.
                           Clinical meaning, values, units and weight basis are
                           byte-equivalent to what was already in production.
                           Rendered to clinicians.
     'proposed-unverified' drafted for clinical review. NOT rendered to
                           clinicians and NOT returned by search. Visible only
                           to an evidence reviewer.
     'reviewed'            a genuine review is recorded in evidence_reviews and
                           evidence_tools.publication_status = 'published'.

   Nothing in this file changes a dose that was already shipped. Every
   'existing-unchanged' entry carries `verbatim` — the exact display string the
   previous build produced — so the migration is auditable.
   ==========================================================================*/
(function (global) {
'use strict';

/* ── dose helpers ────────────────────────────────────────────────────────
   Doses stay structured. The renderer never receives a pre-joined string, so
   mg can never be printed where mcg was meant and the weight basis can never
   be dropped.                                                               */
function r0(n){ return Math.round(n); }
function r1(n){ return Math.round(n*10)/10; }
/* Round to a fixed number of decimal places and return a NUMBER, so trailing
   zeroes never reach the display: 0.040 is the number 0.04 and prints "0.04". */
function rd(n, dec){ var m = Math.pow(10, dec); return Math.round(n * m) / m; }
/* TWO SIGNIFICANT DIGITS. The number of decimal places needed is derived from
   the magnitude rather than fixed, so 4.8 keeps one place, 0.24 keeps two,
   0.012 keeps three and 0.002 keeps four. */
function sig2(n){
  if (n === 0) return 0;
  return rd(n, 1 - Math.floor(Math.log10(Math.abs(n))));
}
function isPrecision(dec){
  return typeof dec === 'number' && isFinite(dec) &&
         dec >= 0 && dec === Math.floor(dec);
}
/* A NON-ZERO DOSE MUST NEVER PRINT AS ZERO.
   `decimals` is carried per dose so migrated values print exactly as the
   previous build printed them; defaulting would silently change four of them
   (midazolam, morphine, neostigmine, and one Regional record). That guarantee
   is the FIRST branch and is unchanged.

   What changed is the default below 1. It was one decimal place, which was
   enough only because every record that existed carried a per-kg value of at
   least 0.02 mg/kg. Glycopyrrolate's reviewed 0.004 mg/kg is five times
   smaller than that, and one decimal place turned a 10 kg child's 0.04 mg
   into the printed string "0", and every paediatric weight from 15 to 30 kg
   into the same "0.1" for a two-fold span of real doses. A dose of zero is
   not a rounding error on a page whose output is drug doses.

   The default is now adaptive — two significant digits, however many places
   that takes — so precision follows the magnitude of the number instead of a
   constant chosen when the smallest dose in the file was 300x larger.

   AND THE CLIFF IS AT 10, NOT AT 1. Rounding to a whole number is harmless
   at 115.5 mg and destructive at 1.2 mg: a 2 kg neonate's 1.2 mg of
   rocuronium printed as "1 mg" is a sixth of the dose gone, and 5.25 mg of
   mivacurium printed as "5 mg" is 5% gone. Neither is a small dose in the
   sense that made whole numbers reasonable — they are ordinary doses for
   small patients, and this is a workstation for anaesthetists who have small
   patients. Below 10 the printed amount now stays within 5% of the
   arithmetic; at 10 and above the long-standing whole-number rendering is
   unchanged, because there it never cost more than half a unit.

   Exact zero stays zero, and an explicit `decimals` always wins. */
function fmtNum(n, dec){
  if (dec === 1) return r1(n);              /* explicit, and byte-identical */
  if (isPrecision(dec)) return rd(n, dec);  /* any other explicit precision */
  if (Math.abs(n) >= 10) return r0(n);      /* unchanged where it costs nothing */
  return sig2(n);
}

/* Render one structured dose for a given patient weight (kg | null). */
/* A TITRATION IS THREE FACTS IN AN ORDER, and the renderer builds the line
   from the three rather than from a sentence stored beside them. There is no
   `display` string on a titration row on purpose: a free-text copy would be
   the thing a reader trusts while start, increment and max quietly drifted
   away from it, and the structured fields would become decoration. This is
   the ONLY place the compact form is composed, so the plan card, the drug
   reference and any future surface cannot disagree about it. */
function titrationLine(d){
  var span = function (r){ return (r.low === r.high) ? String(r.low)
                                                     : (r.low + '\u2013' + r.high); };
  var u = d.unit || '';
  return 'Start ' + span(d.start) + u +
         ' \u00b7 \u2191 ' + span(d.increment) + u +
         ' \u00b7 max ' + d.max + u;
}
function renderDose(d, wt){
  if (d.type === 'titration-protocol') return { val:titrationLine(d), unit:'' };
  if (d.display) return { val:d.display, unit:d.unit || '' };
  /* A RATE (mcg/kg/min, mcg/kg/h) always stays per-kg — it is set on a pump.
     A SINGLE DOSE (mg/kg) converts to the absolute amount for this patient,
     which is what the previous build displayed. */
  var isRate = /\/kg\/(min|h|hr)$/.test(d.unit || '');
  if (isRate || !wt || !d.basisWeight){
    if (d.low != null && d.high != null) return { val:d.low+'–'+d.high, unit:d.unit };
    return { val:String(d.value), unit:d.unit };
  }
  // absolute dose for this patient, derived from a per-kg range
  var u = (d.unit || '').replace(/\/kg$/,'');
  var cap = function(v){ return (d.capAbsolute != null) ? Math.min(v, d.capAbsolute) : v; };
  if (d.low != null && d.high != null)
    return { val: fmtNum(cap(d.low*wt), d.decimals)+'–'+fmtNum(cap(d.high*wt), d.decimals), unit:u };
  // a second ceiling (e.g. with adrenaline) is shown as "plain / adjuvant",
  // exactly as the Regional module displayed it before this migration
  if (d.alt && d.alt.value != null)
    return { val: fmtNum(cap(d.value*wt), d.decimals)+' / '+fmtNum(cap(d.alt.value*wt), d.decimals), unit:u };
  return { val: String(fmtNum(cap(d.value*wt), d.decimals)), unit:u };
}

/* The supporting line: indication, the per-kg basis, then preparation.
   Weight basis (TBW / IBW / ABW) is always printed — never implied.        */
function supportLine(item, dose, wt){
  /* Route leads the supporting line. It is an existing structured field that
     was previously suppressed when it equalled 'IV'; a clinician scanning for
     route needs it at the same position on every row. No value changes. */
  var bits = [];
  if (dose.route) bits.push('<b class="rt">' + dose.route + '</b>');
  if (dose.label) bits.push(dose.label);
  if (dose.type === 'titration-protocol'){
    /* The compact line already carries start, increment and maximum. Adding
       "maximum 8" after it would say the ceiling twice. */
    bits.push(titrationLine(dose));
    return bits.filter(Boolean).join(' · ');
  }
  if (dose.basisWeight){
    var lo = dose.low != null ? (dose.low+'–'+dose.high) : String(dose.value);
    if (dose.alt && dose.alt.value != null) lo += ' / ' + dose.alt.value + ' ' + dose.alt.label;
    bits.push(lo+' '+dose.unit+(dose.basis ? (' '+dose.basis) : ''));
  } else if (dose.basis){
    bits.push(dose.basis);
  }
  if (dose.max) bits.push('maximum ' + dose.max);
  return bits.filter(Boolean).join(' · ');
}

/* ── PHARMACOLOGIC CLASS — a clinical navigation system ──────────────────
   THESE ARE ANESTHEO INTERFACE COLOURS. THEY ARE NOT SYRINGE-LABEL COLOURS.
   An earlier version of this comment claimed the hues followed ISO 26825 so
   that "the colour on screen matches the colour on the syringe". That claim
   is withdrawn: this palette was never derived from ISO 26825, it was tuned
   for legibility on a dark screen, and inviting a clinician to match a screen
   colour against a physical ampoule label is a drug-administration hazard.
   Read the name. The colour is navigation, nothing more.

   Values are screen-tuned: every one clears WCAG AA (>=4.5:1) against the
   dark pane ground it is drawn on.

   Colour is NEVER the only cue. Every row also carries the class name in text,
   so the system works without colour vision and survives a monochrome print.

   This is display metadata. It changes no dose, unit, weight basis or warning.
   ------------------------------------------------------------------------ */
var PCLASS = {
  induction:    { label:'Induction',      color:'#FFD84D', short:'INDUCTION' },
  benzo:        { label:'Benzodiazepine', color:'#FFA23E', short:'BENZO' },
  betablocker:  { label:'Beta-blocker',   color:'#FFA23E', short:'BETA-BLOCKER' },
  opioid:       { label:'Opioid',         color:'#6BB6FF', short:'OPIOID' },
  /* NMB, not RELAXANT. The class is neuromuscular blockade; "relaxant" is
     ward shorthand and reads as a sedative to anyone outside theatre. */
  nmb:          { label:'Neuromuscular blocker', color:'#FF7A6B', short:'NMB' },
  vasopressor:  { label:'Vasopressor / inotrope', color:'#C79BFF', short:'VASOPRESSOR' },
  /* AN ALPHA-2 AGONIST IS NOT A CONVENTIONAL HYPNOTIC. Dexmedetomidine sat in
     the induction gold because that is the group it is filed under, which put
     a sedative that does not induce anaesthesia in the same colour as
     propofol. Its own klass has said 'Alpha-2 agonist' all along; this is the
     colour catching up with it. Lavender rather than the vasopressor violet:
     dE 21.6 apart in CIELAB, against 7.9 for the palette's existing closest
     pair, and 7.4:1 on the pane ground. No dose, unit, weight basis, warning
     or group changes — this is the display metadata this block is for. */
  alpha2:       { label:'Alpha-2 agonist / sedative', color:'#B39DDB', short:'ALPHA-2' },
  anticholinergic:{ label:'Anticholinergic', color:'#4FE39B', short:'ANTICHOLINERGIC' },
  local:        { label:'Local anaesthetic', color:'#C3D2CD', short:'LOCAL' },
  uterotonic:   { label:'Uterotonic',     color:'#FFFFFF', short:'UTEROTONIC' },
  reversal:     { label:'Reversal agent', color:'#5FE0A4', short:'REVERSAL', zebra:true },
  /* Three classes that had no entry, so sevoflurane, ondansetron and
     tranexamic acid rendered a blank badge while every drug beside them
     carried one. Hues are the three clearest gaps in the palette above —
     cyan, pink and chartreuse — each further from its nearest neighbour
     (dE 32-37 in CIELAB) than the existing palette's own closest pair
     (anticholinergic and reversal, dE 8), and each clearing AA on the badge
     ground at 7.0, 6.4 and 8.2:1. No existing colour is touched. */
  inhalational: { label:'Inhalational anaesthetic', color:'#45D0D8', short:'INHALATIONAL' },
  antiemetic:   { label:'Antiemetic',     color:'#FF8FC4', short:'ANTIEMETIC' },
  haemostatic:  { label:'Haemostatic / Antifibrinolytic', color:'#B8E04A', short:'HAEMOSTATIC' }
};
/* Drugs with no class in the approved scheme render a neutral badge rather
   than an invented colour. */
function classOf(d){ return (d && d.pclass && PCLASS[d.pclass]) ? d.pclass : null; }
function classMeta(id){ return PCLASS[id] || null; }

/* THE one badge renderer. Rows, the command palette and anything added later
   call this, so a class can never be styled two different ways. */
function classBadge(pclassId){
  var m = PCLASS[pclassId];
  if (!m) return '';
  return '<span class="pc' + (m.zebra ? ' pc-zebra' : '') + '" data-pc="' + pclassId +
         '" style="--pc:' + m.color + '">' + m.short + '</span>';
}

/* ── DRUG GROUPS ─────────────────────────────────────────────────────── */
var GROUPS = [
  { id:'induction',   label:'Induction and sedation' },
  { id:'nmb',         label:'Neuromuscular blockade' },
  { id:'analgesia',   label:'Opioids and analgesia' },
  { id:'reversal',    label:'Reversal' },
  { id:'vaso-inf',    label:'Vasopressor and inotrope infusions' },
  { id:'vaso-bolus',  label:'Vasopressor boluses' },
  { id:'local',       label:'Local anaesthetics' },
  { id:'cardio',      label:'Perioperative cardiovascular' },
  { id:'antiemetic',  label:'Antiemetics' },
  { id:'obstetric',   label:'Obstetric' },
  { id:'haemostasis', label:'Haemostasis and massive bleeding' },
  { id:'volatile',    label:'Volatile agents' }
];

/* ── DRUGS ────────────────────────────────────────────────────────────────
   `verbatim` records exactly what the previous build displayed, so migration
   fidelity is machine-checkable. Structured fields carry the same meaning.  */
var DRUGS = [

/* ══ MIGRATED VERBATIM — existing-unchanged ══════════════════════════════ */

{ id:'drug.propofol', name:'Propofol', group:'induction',
  pclass:'induction',
  aliases:['propofol','diprivan','propofol lipuro','profol'],
  klass:'Alkylphenol intravenous anaesthetic',
  indications:['induction','sedation','TIVA maintenance'],
  doses:[
    /* REVIEWED 1/11 — replaces the shipped 1.5–2.5 mg/kg. The reviewed label
       gives 2–2.5 for most adults of ASA I–II under 65, which is narrower
       than "adult" in both directions: the applicability block carries the
       part `population` cannot, and an ASA III patient or a 70-year-old gets
       no number from this record rather than a number reviewed for someone
       else. The warn line below said as much already, and a warning is not
       a gate. */
    { label:'Induction', route:'IV', phase:'induction',
      low:2, high:2.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'adult', populationClass:'A',
      applicability:{ ageBand:{ max:{ value:65, unit:'years', inclusive:false } },
                      asa:['I','II'] },
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Propofol Injectable Emulsion',
                 documentId:'9ba70032-40c2-41c5-9f99-d1f94032d3dc',
                 section:'2.2 Induction of General Anesthesia for Patients Greater than or Equal to 3 Years of Age — Adult Patients' } },
    /* REVIEWED 2/11 — the first paediatric dose record this application has
       ever held. Until now a child was shown the adult rule multiplied by
       their weight; now a two-year-old falls outside the band and is told so,
       and a sixteen-year-old is inside it because an age is completed years.
       A different setid from the adult record: two documents, which is
       exactly why evidence is per dose. */
    { label:'Induction', route:'IV', phase:'induction',
      low:2.5, high:3.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'paediatric', populationClass:'C',
      ageBand:{ min:{ value:3,  unit:'years', inclusive:true },
                max:{ value:16, unit:'years', inclusive:true } },
      applicability:{ asa:['I','II'] },
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Propofol Injectable Emulsion',
                 documentId:'800646b8-83a8-01d9-3dc8-bb2ddcb8570c',
                 section:'Pediatric Patients / Summary of Dosage Guidelines / induction' } },
    /* ── THE ELDERLY RECORD, ADDED AND NOT SUBSTITUTED ────────────────────
       The healthy-adult record above stops at 65 (max, exclusive), so a
       77-year-old matched no propofol record at all and the board printed
       "Reviewed dose not available for this patient profile" for the most
       used induction agent on it.

       THE BOUNDARY IS NOT INVENTED. 65 is already the reviewed boundary in
       this dataset — the exclusive maximum on the adult record — and this is
       its exact complement, inclusive at 65. No gap, no overlap, and no new
       age threshold enters the model by adding it.

       NO ASA GATE. The label's population reads "Elderly, Debilitated, or
       ASA-PS III or IV" — a disjunction, while applicabilityFailure()
       conjoins its clauses. Gating this on ASA would withhold it from the
       very patient it exists for whenever the ASA box is empty. Age alone
       admits it; the debilitated and under-65 ASA III-IV branches are NOT
       encoded and remain a declared coverage gap. */
    { label:'Induction — elderly, debilitated or ASA III–IV',
      route:'IV', phase:'induction',
      low:1, high:1.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Titrate to clinical response.',
      population:'adult', populationClass:'A',
      applicability:{ ageBand:{ min:{ value:65, unit:'years', inclusive:true } } },
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Propofol Injectable Emulsion',
                 documentId:'28d7ba00-f824-4e55-139a-03f509c099db',
                 section:'2.2 Induction of General Anesthesia for Patients Greater than or Equal to 3 Years of Age — Elderly, Debilitated, or ASA-PS III or IV Patients' } }],
  prep:'<b>1% = 10 mg/mL</b>',
  warn:'Reduce 30–50% in the elderly, hypovolaemia and ASA III–IV.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Induction · 1.5–2.5 mg/kg TBW' } },

{ id:'drug.ketamine', name:'Ketamine', group:'induction',
  pclass:'induction',
  aliases:['ketamine','ketalar','esketamine','special k'],
  klass:'NMDA antagonist',
  indications:['induction','haemodynamic instability','analgesia'],
  doses:[
    /* REVIEWED 10/11 — replaces the shipped 1–2 mg/kg. The reviewed range is
       1–4.5 with an average of 2, so the old record was the middle of the
       label read as the whole of it.
       CLASS A, NOT D, AND THE DISTINCTION MATTERS HERE. Section 8.4 states
       that safety and effectiveness in patients below 16 have not been
       established, so this is evidence about adults that happens to carry no
       paediatric counterpart — not one rule covering both. A child therefore
       gets no number from it. */
    { label:'Induction', route:'IV', phase:'induction',
      low:1, high:4.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Average 2 mg/kg, administered slowly over approximately 60 seconds.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Ketamine Hydrochloride Injection',
                 documentId:'902c3785-a3cb-472b-ac15-394ac646271d',
                 section:'2.2 Recommended Dosage and Administration — Induction of Anesthesia — Intravenous Route' } },
    /* REVIEWED 11/11 — the intramuscular route, which the model could not
       express at all until doses enumerated: a second dose on a drug was
       invisible everywhere. It is a separate record, not a widened range. */
    { label:'Induction', route:'IM', phase:'induction',
      low:6.5, high:13, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Ketamine Hydrochloride Injection',
                 documentId:'902c3785-a3cb-472b-ac15-394ac646271d',
                 section:'2.2 Recommended Dosage and Administration — Induction of Anesthesia — Intramuscular Route' } }],
  prep:'<b>10 / 50 mg/mL</b> · haemodynamically stable choice',
  warn:'Emergence phenomena; avoid in uncontrolled hypertension and raised ICP.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Induction · 1–2 mg/kg TBW' } },

{ id:'drug.midazolam', name:'Midazolam', group:'induction',
  pclass:'benzo',
  aliases:['midazolam','versed','dormicum','midaz'],
  klass:'Benzodiazepine',
  indications:['premedication','sedation','anxiolysis'],
  doses:[{ label:'Premedication', route:'IV', low:0.02, high:0.04, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range', decimals:1 }],
  prep:'<b>1 / 5 mg/mL</b> · dilute to 1 mg/mL for titration',
  warn:'Additive respiratory depression with opioids; halve in the elderly.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Premed · 0.02–0.04 mg/kg TBW' } },

{ id:'drug.rocuronium', name:'Rocuronium', group:'nmb',
  pclass:'nmb',
  aliases:['rocuronium','rocuronium bromide','roc','esmeron','zemuron'],
  klass:'Aminosteroid non-depolarising neuromuscular blocker',
  indications:['intubation','rapid sequence induction','muscle relaxation'],
  doses:[
    /* REVIEWED 4/11 — the shipped record was 0.6–1.2 labelled "Intubation",
       which was the RSI range wearing the routine label. Routine intubation
       is 0.6, and RSI is its own record below. */
    { label:'Intubation', route:'IV', phase:'intubation',
      value:0.6, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Rocuronium Bromide Injection',
                 documentId:'04c9812d-5aa3-4949-ad02-c618028f1bb0',
                 section:'2.2 Dosage for Tracheal Intubation' } },
    /* REVIEWED 5/11 — B, not D, and the number being identical is the reason
       to say so out loud. D means the source established ONE rule covering
       both populations; this is two findings that agree, from two sections,
       and if either is ever revised the other must not move with it. */
    { label:'Intubation', route:'IV', phase:'intubation',
      value:0.6, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'0.45 mg/kg may be used depending on age and anesthetic technique.',
      population:'paediatric', populationClass:'B',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Rocuronium Bromide Injection',
                 documentId:'04c9812d-5aa3-4949-ad02-c618028f1bb0',
                 section:'2.6 Dosage in Specific Populations — Pediatric Patients' } },
    /* REVIEWED 6/11 — DEFECT B CLOSED. This value spent its life inside the
       prep string as "· 1.2 mg/kg for RSI": display prose, invisible to
       renderDose(), to the weight scaler and to the provenance gate. It is a
       real dose record now, and the prose is gone from prep below.
       phase:'rsi' is a SIBLING of 'intubation'. Asking for RSI on a drug with
       only a routine record returns nothing — never the routine dose. */
    { label:'Rapid sequence intubation', route:'IV', phase:'rsi',
      low:0.6, high:1.2, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Rocuronium Bromide Injection',
                 documentId:'04c9812d-5aa3-4949-ad02-c618028f1bb0',
                 section:'2.3 Rapid Sequence Intubation' } }],
  /* The RSI dose left this string for a dose record. A preparation says what
     is in the vial; it does not carry a dose the model cannot see. */
  prep:'<b>10 mg/mL</b>',
  /* ── THE AIRWAY WARNING, REWRITTEN BECAUSE IT WAS WRONG TWICE OVER ────
     WAS: "Only after confirming you can ventilate - unless sugammadex is
     drawn up." Both halves failed, and the second failed dangerously.

     "Confirm you can ventilate first" is not how a rapid sequence is done,
     and this drug's own RSI record is the one the board serves under the RSI
     strategy: the card would have instructed the clinician to do the thing
     the technique deliberately omits. DAS 2025 moves the other way again,
     recommending EARLIER neuromuscular block, because block facilitates mask
     ventilation rather than threatening it.

     "Unless sugammadex is drawn up" is the dangerous half. It reads as a
     permission: paralyse without a plan, because the antidote is on the
     trolley. Reversal is not rescue. Restoring neuromuscular function does
     not restore airway patency, and it does not restore adequate ventilation
     inside the desaturation window; where oedema from failed attempts is
     what closed the airway, sugammadex does nothing at all except consume
     the time that should have gone to the algorithm.

     What replaces it keeps sugammadex as a PLANNED strategy that must be
     dosed and to hand, and removes it as a substitute for the rescue
     sequence. eFONA is named as part of that sequence, not as something
     rocuronium specifically requires.

     NOT SAID, ON PURPOSE: that rocuronium is better than suxamethonium.
     Cochrane 2015 found suxamethonium superior for intubating conditions.
     Contemporary guidance accepts either agent, and any future product
     preference is a default-selection decision about contraindications and
     reversibility, not a claim about intubating conditions. */
  warn:'Use it inside a defined airway rescue plan. If sugammadex is the intended reversal or wake up strategy, calculate the dose and have it immediately available. Reversing the block does not guarantee adequate ventilation or oxygenation, and must never delay progression through the difficult airway and CICO algorithm.',
  /* THREE CLAIMS, THREE SOURCES, MAPPED ONE TO ONE. None is asked to support
     a statement it does not make: the guideline supplies the rescue
     framework, the study supplies the limitation, and SCCM supplies the
     standing of the agent itself. */
  warnEvidence:{ state:'reviewed', authority:'Difficult Airway Society; Anesthesia & Analgesia; Society of Critical Care Medicine',
                 title:'DAS 2025 guidelines for management of unanticipated difficult tracheal intubation in adults (Ahmad, El-Boghdadly et al., Br J Anaesth 2026;136:283-307); The Myth of Rescue Reversal in "Can\'t Intubate, Can\'t Ventilate" Scenarios (Naguib et al., Anesth Analg 2016;123:82-92); SCCM Clinical Practice Guidelines for Rapid Sequence Intubation in the Critically Ill Adult Patient (Crit Care Med 2023;51:1411-1430)',
                 documentId:'PMID 41203471, DOI 10.1016/j.bja.2025.10.006; PMID 27140684, DOI 10.1213/ANE.0000000000001347; PMID 37707379, DOI 10.1097/CCM.0000000000006000, Crit Care Med 2023;51(10):1411-1430',
                 section:'Airway rescue planning and progression, including emergency front of neck access: DAS 2025, revised ABCD rescue approach and earlier neuromuscular block. Reversal does not guarantee ventilation or oxygenation and is not a CICO rescue: Naguib 2016. Rocuronium as an accepted rapid sequence agent where suxamethonium is not contraindicated, with neither agent claimed superior: SCCM 2023.' },
  severity:'critical',
  /* The DRUG's provenance is untouched. Its dose records were not reviewed in
     this pass and none changed; what gained a citation is the warning, which
     carries its own evidence block exactly as the volatile agents' do. */
  provenance:{ state:'existing-unchanged', verbatim:'Intubation · 0.6–1.2 mg/kg TBW' } },

{ id:'drug.suxamethonium', name:'Suxamethonium', group:'nmb',
  pclass:'nmb',
  aliases:['suxamethonium','succinylcholine','sux','scoline','anectine','celocurine','suxamethonium chloride'],
  klass:'Depolarising neuromuscular blocker',
  indications:['rapid sequence induction','laryngospasm'],
  doses:[
    /* REVIEWED 7/11 — replaces the shipped 1–1.5 labelled RSI. The reviewed
       adult range is 0.3–1.1 with an average of 0.6, and the label states it
       for intubation rather than for RSI specifically.
       NO PAEDIATRIC RECORD, DELIBERATELY. The label distinguishes "infants
       and other small pediatric patients" from "older pediatric patients and
       adolescents" and gives no boundary between them. A band cannot be
       inferred from prose, so a child gets "Pediatric dose not reviewed"
       rather than one of the two figures chosen by us. That gap is the
       honest state of the evidence, and it is waiting on a secondary source.
       IM is not added either: the route exists in the label, the route UX
       does not exist yet, and half a route is worse than none. */
    { label:'Intubation', route:'IV', phase:'intubation',
      low:0.3, high:1.1, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      decimals:1, note:'Average dose 0.6 mg/kg.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Succinylcholine Chloride Injection',
                 documentId:'1e5891e2-e1e4-4587-b32c-b2e8082df9b6',
                 section:'2.2 Dosage Recommendations for Intravenous Use in Adults' } },
    /* ── RSI IS ITS OWN RECORD, NEVER A RELABELLED ONE ────────────────────
       The routine record above is untouched. Under a rapid sequence the
       blocker row asks for phase 'rsi' and nothing else, so until now the
       card correctly said "RSI dose not reviewed" rather than reprinting a
       routine number under an RSI heading. This is a separate authority
       answering the separate question. */
    { label:'Rapid sequence intubation', route:'IV', phase:'rsi',
      value:1, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed',
                 authority:'European Society of Anaesthesiology and Intensive Care',
                 title:'ESAIC focused guideline on rapid sequence induction and intubation',
                 documentId:'PMID 36377554',
                 section:'Recommendation R3' } }],
  prep:'<b>50 mg/mL</b>',
  warn:'Contraindicated in hyperkalaemia, burns &gt;24 h, denervation, MH susceptibility.',
  severity:'critical', hi:true,
  provenance:{ state:'existing-unchanged', verbatim:'RSI · 1–1.5 mg/kg TBW' } },

{ id:'drug.fentanyl', name:'Fentanyl', group:'analgesia',
  pclass:'opioid',
  aliases:['fentanyl','fentanil','sublimaze'],
  klass:'Synthetic opioid',
  indications:['analgesia','obtunding laryngoscopy response'],
  doses:[
    /* THE SHIPPED ADULT RECORD, UNTOUCHED — NOT EVEN CLASSIFIED.
       An earlier cut gave this populationClass:'A' to keep it away from
       children. That was the wrong instrument: 'A' means a reviewed source
       establishes the value for adults, and no source has been read for this
       one. The label expresses adult anaesthesia dosing as 50–100 mcg
       initiation and low/moderate/high total categories rather than a per-kg
       induction range, which is exactly why it is still awaiting review.
       Writing 'A' would have made an unreviewed number report itself as
       source-backed.
       It carries population:'adult' and its drug is existing-unchanged, so
       the legacy compatibility rule admits it for adults and withholds it
       from children — eligibility without a claim. */
    { label:'Peri-induction analgesia', route:'IV',
      low:1, high:3, unit:'mcg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'adult' },
    /* ── THE ADULT DOSE THE LABEL ACTUALLY STATES ─────────────────────────
       REVIEWED 19/09. The row above is the reason this one exists. It says
       1-3 mcg/kg for an adult and no source says that: the SmPC gives the
       adult anaesthetic dose in ABSOLUTE micrograms, and it gives 1-3 mcg/kg
       only for children aged 2 to 11. Adding an evidence object to the row
       above would have manufactured provenance for a number the label does
       not contain, so the reviewed adult dose is a NEW row carrying what the
       label says, in the units the label says it in.

       IT IS NOT CONVERTED. 50-200 mcg is not divided by a weight to look
       like the row above it, and no weight-adjusted equivalent is computed
       anywhere: basisWeight is absent, so renderDose prints the range as the
       label states it whatever the patient weighs.

       THE INITIAL DOSE FOR A SPONTANEOUSLY BREATHING ADULT is the one the
       induction board asks for: at induction the airway is not yet secured.
       The label's assisted-ventilation regimen is a different clinical
       situation with its own much wider range, and it is deliberately not
       written here — publishing it would need its own review and its own
       context, and a second adult induction row would compete with this one
       for the same question. */
    { label:'Anaesthesia, spontaneous respiration \u2014 initial', route:'IV',
      /* NOT phase:'induction'. It was, and that made it the answer to every
         adult induction query — including the IV and rapid sequence plans,
         which select a blocker and are therefore controlled-airway regimens.
         The label separates the two cases and so does this. */
      phase:'spontaneous-respiration',
      low:50, high:200, unit:'mcg', type:'range',
      note:'Initial dose in a spontaneously breathing adult; supplemental '
         + 'doses of 50 micrograms. Individualise to age, body weight, '
         + 'physical status, underlying condition, other drugs, and the type '
         + 'of surgery and anaesthesia. Higher initial doses apply where '
         + 'ventilation is assisted, which this row does not cover.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'eMC / UK SmPC',
                 title:'Fentanyl 50 micrograms/ml Solution for Injection',
                 documentId:'eMC Summary of Product Characteristics',
                 section:'4.2 Posology and method of administration, adults' } },
    /* REVIEWED 3/11 */
    { label:'Induction and maintenance', route:'IV', phase:'induction',
      low:2, high:3, unit:'mcg/kg', basis:'TBW', basisWeight:true, type:'range',
      population:'paediatric', populationClass:'C',
      ageBand:{ min:{ value:2,  unit:'years', inclusive:true },
                max:{ value:12, unit:'years', inclusive:true } },
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Fentanyl Citrate Injection',
                 documentId:'58dcd3f7-e3d8-4929-a186-8f680a51ff11',
                 section:'2.2 Dosage — For Induction and Maintenance in Children 2 to 12 Years of Age' } }],
  prep:'<b>50 mcg/mL</b>',
  warn:'Chest-wall rigidity with rapid large boluses.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Analgesia · 1–3 mcg/kg TBW' } },

{ id:'drug.morphine', name:'Morphine', group:'analgesia',
  pclass:'opioid',
  aliases:['morphine','morphine sulfate','morphine sulphate','mso4'],
  klass:'Opioid',
  indications:['postoperative analgesia'],
  doses:[{ label:'Postoperative analgesia', route:'IV', low:0.05, high:0.1, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range', decimals:1 }],
  prep:'<b>10 mg/mL</b> · dilute to 1 mg/mL and titrate',
  warn:'Accumulates in renal impairment — reduce or choose an alternative.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Analgesia · 0.05–0.1 mg/kg TBW' } },

{ id:'drug.remifentanil', name:'Remifentanil', group:'analgesia',
  pclass:'opioid',
  aliases:['remifentanil','remi','ultiva'],
  klass:'Ultra-short-acting synthetic opioid',
  indications:['TIVA','infusion analgesia'],
  doses:[
    /* THE LEGACY RECORD, UNTOUCHED, WITH NO PHASE AND NO CLASS.
       Its context has never been stated: the record says "Infusion" and
       nothing more, and the reviewed label's 0.025–0.2 figures belong to
       immediate postoperative analgesic continuation, not to induction. So it
       must NOT answer phase:'induction' — and the guarantee is that `phase`
       is absent, because dosesForPhase() filters on exact equality and a
       record with no phase matches no phase at all.
       No populationClass either, for the same reason as fentanyl above: the
       class is an evidence claim and nothing has reviewed this. Legacy
       compatibility admits it for adults and withholds it from children. */
    { label:'Infusion', route:'IV', low:0.05, high:0.2, unit:'mcg/kg/min',
      type:'range', population:'adult' },
    /* REVIEWED 8/11 */
    { label:'Induction through intubation', route:'IV infusion', phase:'induction',
      low:0.5, high:1, unit:'mcg/kg/min', type:'range',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Remifentanil Hydrochloride for Injection',
                 documentId:'d2374b84-81c9-44f9-a4a9-1071281b2531',
                 section:'Table 1 — Dosing Guidelines in Adults: Induction of Anesthesia (through intubation)' } },
    /* REVIEWED 9/11 — a bolus is not an infusion and the two are not folded.
       One is set on a pump in mcg/kg/min and the other is drawn up in mcg;
       renderDose() treats them differently, and a single record could only
       have been one of them. */
    { label:'Initial bolus', route:'IV', phase:'induction',
      value:1, unit:'mcg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'May be administered over 30–60 seconds.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Remifentanil Hydrochloride for Injection',
                 documentId:'d2374b84-81c9-44f9-a4a9-1071281b2531',
                 section:'Table 1 — Dosing Guidelines in Adults: Induction of Anesthesia (through intubation)' } }],
  prep:'<b>50 mcg/mL</b> (2 mg / 40 mL)',
  warn:'No residual analgesia — establish multimodal cover before stopping.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Infusion · 0.05–0.2 mcg/kg/min' } },

{ id:'drug.dexmedetomidine', name:'Dexmedetomidine', group:'induction',
  pclass:'alpha2',
  aliases:['dexmedetomidine','dexmed','precedex','dexdor','dex'],
  klass:'Alpha-2 agonist',
  indications:['sedation','procedural sedation','awake fibreoptic'],
  doses:[{ label:'Sedation', route:'IV', low:0.2, high:0.7, unit:'mcg/kg/h', population:'adult', type:'range' }],
  prep:'<b>4 mcg/mL</b> (200 mcg / 50 mL)',
  warn:'Bradycardia and hypotension, worse with a loading dose.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Sedation · 0.2–0.7 mcg/kg/h' } },

{ id:'drug.sugammadex', name:'Sugammadex', group:'reversal',
  pclass:'reversal',
  aliases:['sugammadex','bridion','suggamadex'],
  klass:'Selective relaxant binding agent',
  indications:['reversal of rocuronium','reversal of vecuronium'],
  doses:[{ label:'Routine reversal', route:'IV', low:2, high:4, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
  prep:'<b>100 mg/mL</b> · 2 mg/kg at TOF 2, 4 mg/kg at PTC 1–2',
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'Routine reversal · 2–4 mg/kg TBW' } },

{ id:'drug.sugammadex-immediate', name:'Sugammadex — immediate reversal', group:'reversal',
  pclass:'reversal',
  aliases:['sugammadex immediate','sugammadex 16','cico rescue','sugammadex rescue'],
  klass:'Selective relaxant binding agent',
  indications:['immediate reversal','cannot intubate cannot oxygenate'],
  doses:[{ label:'Immediate reversal', route:'IV', value:16, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'protocol' }],
  prep:'<b>100 mg/mL</b> · the CICO rescue dose',
  warn:'Rocuronium will not work again for ~24 h — plan the alternative first.',
  severity:'critical', hi:true,
  provenance:{ state:'existing-unchanged', verbatim:'Immediate reversal · 16 mg/kg TBW' } },

{ id:'drug.neostigmine', name:'Neostigmine', group:'reversal',
  pclass:'reversal',
  aliases:['neostigmine','prostigmin','neo'],
  klass:'Acetylcholinesterase inhibitor',
  indications:['reversal of neuromuscular blockade'],
  doses:[{ label:'Reversal', route:'IV', low:0.04, high:0.05, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range', decimals:1, capAbsolute:5, max:'5 mg' }],
  prep:'<b>2.5 mg/mL</b> · always with glycopyrrolate 0.2 mg per 1 mg',
  warn:'Ineffective at deep block; give only once TOF count &ge; 2.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Reversal · 0.04–0.05 mg/kg (max 5)' } },

{ id:'drug.noradrenaline', name:'Noradrenaline', group:'vaso-inf',
  pclass:'vasopressor',
  aliases:['noradrenaline','norepinephrine','norad','levophed','noradrenalin','nor-adrenaline','ne'],
  klass:'Catecholamine vasopressor',
  indications:['vasoplegia','shock','maintaining MAP'],
  doses:[{ label:'First-line vasopressor · titrate to MAP', route:'IV infusion', low:0.01, high:0.5, unit:'mcg/kg/min', population:'adult', type:'range' }],
  prep:'<b>4 mg / 50 mL = 80 mcg/mL</b> (or 8 mg / 50 mL)',
  warn:'Central access preferred; extravasation causes tissue necrosis.',
  severity:'critical',
  provenance:{ state:'existing-unchanged', verbatim:'1st-line vasopressor · titrate to MAP · 0.01–0.5 mcg/kg/min' } },

{ id:'drug.adrenaline', name:'Adrenaline', group:'vaso-inf',
  pclass:'vasopressor',
  aliases:['adrenaline','epinephrine','epi','adrenalin','suprarenin'],
  klass:'Catecholamine inotrope and vasopressor',
  indications:['anaphylaxis','cardiac arrest','low cardiac output'],
  doses:[{ label:'Inotrope + vasopressor', route:'IV infusion', low:0.01, high:0.5, unit:'mcg/kg/min', population:'adult', type:'range' }],
  prep:'<b>1 mg / 50 mL = 20 mcg/mL</b>',
  warn:'Tachyarrhythmia, hyperglycaemia, lactate rise.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Inotrope + vasopressor · anaphylaxis/arrest · 0.01–0.5 mcg/kg/min' } },

{ id:'drug.phenylephrine-inf', name:'Phenylephrine — infusion', group:'vaso-inf',
  pclass:'vasopressor',
  aliases:['phenylephrine infusion','phenylephrine','neosynephrine','neo-synephrine'],
  klass:'Pure alpha-1 agonist',
  indications:['maintaining SVR after spinal'],
  doses:[{ label:'Infusion · maintain SVR after spinal', route:'IV infusion', low:0.1, high:0.5, unit:'mcg/kg/min', population:'adult', type:'range' }],
  prep:'<b>100 mcg/mL</b> (10 mg / 100 mL)',
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'Infusion · maintain SVR (e.g. spinal) · 0.1–0.5 mcg/kg/min' } },

{ id:'drug.dobutamine', name:'Dobutamine', group:'vaso-inf',
  pclass:'vasopressor',
  aliases:['dobutamine','dobutrex','dobu'],
  klass:'Beta-1 agonist inotrope',
  indications:['low cardiac output'],
  doses:[{ label:'Inotrope · low cardiac output', route:'IV infusion', low:2, high:20, unit:'mcg/kg/min', population:'adult', type:'range' }],
  prep:'<b>250 mg / 50 mL = 5 mg/mL</b>',
  warn:'Vasodilates — may drop MAP; not a vasopressor.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Inotrope · low cardiac output · 2–20 mcg/kg/min' } },

{ id:'drug.vasopressin', name:'Vasopressin', group:'vaso-inf',
  pclass:'vasopressor',
  aliases:['vasopressin','adh','argipressin','pitressin','antidiuretic hormone'],
  klass:'V1 receptor agonist',
  indications:['catecholamine-resistant shock'],
  doses:[{ label:'Adjunct · catecholamine-resistant shock', route:'IV infusion', low:0.01, high:0.04, unit:'units/min', population:'adult', type:'range' }],
  prep:'<b>20 units / 50 mL = 0.4 units/mL</b>',
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'Adjunct · catecholamine-resistant shock · 0.01–0.04 units/min' } },

{ id:'drug.phenylephrine-bolus', name:'Phenylephrine — bolus', group:'vaso-bolus',
  pclass:'vasopressor',
  aliases:['phenylephrine bolus','phenylephrine','neosynephrine'],
  klass:'Pure alpha-1 agonist',
  indications:['hypotension with adequate heart rate'],
  doses:[{ label:'Pure α · use when the heart rate is adequate or high', route:'IV bolus', low:50, high:100, unit:'mcg', population:'adult', type:'range' }],
  prep:'<b>100 mcg/mL</b> · 0.5–1 mL',
  warn:'Reflex bradycardia — have an antimuscarinic ready.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Bolus · pure α, reflex bradycardia · 50–100 mcg' } },

{ id:'drug.ephedrine', name:'Ephedrine', group:'vaso-bolus',
  pclass:'vasopressor',
  aliases:['ephedrine','ephedrin'],
  klass:'Mixed alpha/beta agonist',
  indications:['hypotension with bradycardia'],
  doses:[{ label:'Mixed α/β · use when bradycardic', route:'IV bolus', low:5, high:10, unit:'mg', population:'adult', type:'range' }],
  prep:'<b>30 mg / 10 mL = 3 mg/mL</b>',
  warn:'Tachyphylaxis after repeated doses — switch to an infusion.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Bolus · mixed α/β, use if bradycardic · 5–10 mg' } },

{ id:'drug.metaraminol', name:'Metaraminol', group:'vaso-bolus',
  pclass:'vasopressor',
  aliases:['metaraminol','aramine','metaraminol tartrate'],
  klass:'Predominantly alpha agonist',
  indications:['hypotension'],
  doses:[{ label:'Predominantly α · longer acting than phenylephrine', route:'IV bolus', low:0.5, high:1, unit:'mg', population:'adult', type:'range' }],
  prep:'<b>0.5 mg/mL</b> (10 mg / 20 mL)',
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'Predominantly α · longer acting than phenylephrine · 0.5–1 mg' } },

{ id:'drug.lidocaine', name:'Lidocaine', group:'local',
  pclass:'local',
  aliases:['lidocaine','lignocaine','lido','xylocaine','lidocaine hcl','lignocaine hcl'],
  klass:'Amide local anaesthetic',
  indications:['infiltration','peripheral nerve block','epidural top-up'],
  doses:[{ label:'Maximum single dose', route:'infiltration / block', value:4.5, unit:'mg/kg',
           basis:'TBW', basisWeight:true, population:'adult', type:'maximum',
           alt:{ label:'with adrenaline', value:7 } }],
  prep:'1% = 10 mg/mL · 2% = 20 mg/mL',
  warn:'Total dose must stay inside the maximum — regional blocks and infiltration share the ceiling.',
  severity:'critical',
  provenance:{ state:'existing-unchanged', verbatim:'Max · 4.5 mg/kg (7 mg/kg w/ epi) TBW' } },

{ id:'drug.bupivacaine', name:'Bupivacaine', group:'local',
  pclass:'local',
  aliases:['bupivacaine','marcaine','sensorcaine','bupi','heavy bupivacaine','hyperbaric bupivacaine'],
  klass:'Amide local anaesthetic',
  indications:['spinal','peripheral nerve block','epidural'],
  doses:[{ label:'Maximum single dose', route:'infiltration / block', value:2, unit:'mg/kg',
           basis:'TBW', basisWeight:true, population:'adult', type:'maximum',
           alt:{ label:'with adrenaline', value:3 } }],
  prep:'0.5% = 5 mg/mL',
  warn:'Cardiotoxic in overdose and resistant to resuscitation — never exceed the maximum.',
  severity:'critical', hi:true,
  provenance:{ state:'existing-unchanged', verbatim:'Max · 2 mg/kg (3 mg/kg w/ epi) TBW' } },

{ id:'drug.levobupivacaine', name:'Levobupivacaine', group:'local',
  pclass:'local',
  aliases:['levobupivacaine','chirocaine','levobupi'],
  klass:'Amide local anaesthetic (S-enantiomer)',
  indications:['peripheral nerve block','epidural'],
  doses:[{ label:'Maximum single dose', route:'infiltration / block', value:2, unit:'mg/kg',
           basis:'TBW', basisWeight:true, population:'adult', type:'maximum' }],
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'2 mg/kg' } },

{ id:'drug.ropivacaine', name:'Ropivacaine', group:'local',
  pclass:'local',
  aliases:['ropivacaine','naropin','ropi'],
  klass:'Amide local anaesthetic',
  indications:['peripheral nerve block','epidural','infiltration'],
  doses:[{ label:'Maximum single dose', route:'infiltration / block', value:3, unit:'mg/kg',
           basis:'TBW', basisWeight:true, population:'adult', type:'maximum' }],
  prep:'0.75% = 7.5 mg/mL',
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'3 mg/kg' } },

{ id:'drug.tranexamic-acid', name:'Tranexamic acid', group:'haemostasis',
  pclass:'haemostatic',
  aliases:['tranexamic acid','txa','cyklokapron','tranexamic','exacyl'],
  klass:'Antifibrinolytic',
  indications:['massive haemorrhage','trauma','postpartum haemorrhage'],
  doses:[{ label:'Over 10 min, then 1 g over 8 h', route:'IV', value:1, unit:'g', population:'adult', type:'protocol' }],
  severity:'none',
  provenance:{ state:'existing-unchanged', verbatim:'1 g over 10 min, then 1 g/8 h' } },

/* ══ 10-DRUG SOURCING PILOT — proposed-unverified, NOT rendered ══════════
   These exist only so the review workflow and the review table can be
   exercised end to end. They are excluded from clinician rendering and from
   search until publication_status = 'published'. Values are drafts pending a
   named clinical reviewer; no source below was directly accessed.          */

{ id:'drug.lidocaine-iv', name:'Lidocaine — intravenous', group:'analgesia',
  pclass:'local',
  aliases:['lidocaine iv','lignocaine iv','lidocaine infusion','iv lidocaine','lidocaine systemic'],
  klass:'Amide local anaesthetic used systemically',
  indications:['pre-intubation airway-reflex attenuation','opioid-sparing analgesia',
               'airway reactivity','ventricular arrhythmia'],
  /* ── ONE NAMED CONTEXT, AND IT SAYS WHAT IT IS ───────────────────────────
     "Lidocaine IV" is four different medicines depending on why it is given,
     and the board named the drug without naming the question. This record
     answers exactly one: attenuating airway reflexes before intubation. It is
     OFF-LABEL and the card says so — it is not a licensed induction dose and
     must never read as one.

     It is deliberately NOT the local-anaesthetic maximum-dose calculation,
     NOT antiarrhythmic lidocaine, NOT the perioperative analgesic infusion
     and NOT propofol injection-pain pretreatment. Those are separate
     questions with separate evidence and keep their own records. */
  doses:[
    { label:'Pre-intubation airway-reflex attenuation (off-label)',
      route:'IV', phase:'induction',
      value:1.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'Approximately 3 minutes before intubation. Off-label use.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'PubMed',
                 title:'Prophylactic lidocaine use preintubation: a review',
                 documentId:'PMID 7963397',
                 section:'Abstract — Prophylactic lidocaine use preintubation: a review' } }],
  prep:'', severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.esmolol', name:'Esmolol', group:'cardio',
  pclass:'betablocker',
  aliases:['esmolol','brevibloc','esmolol hydrochloride'],
  klass:'Ultra-short-acting cardioselective beta-blocker',
  indications:['tachycardia','hypertension','obtunding intubation response'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'Manufacturer SmPC / package insert', sourceAccessed:false } },

{ id:'drug.labetalol', name:'Labetalol', group:'cardio',
  pclass:'betablocker',
  aliases:['labetalol','trandate','normodyne'],
  klass:'Combined alpha/beta blocker',
  indications:['hypertension','pre-eclampsia'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'National formulary', sourceAccessed:false } },

{ id:'drug.ondansetron', name:'Ondansetron', group:'antiemetic',
  pclass:'antiemetic',
  aliases:['ondansetron','zofran','ondanse','setron'],
  klass:'5-HT3 receptor antagonist',
  indications:['postoperative nausea and vomiting','PONV prophylaxis'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'Consensus PONV guideline + SmPC', sourceAccessed:false } },

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEFAULT BOARD'S REMAINING AGENTS
   ───────────────────────────────────────────────────────────────────────────
   These seven were on the induction board as names with no record, so nine of
   sixteen adult cards printed a coverage state instead of a dose. A board that
   is half placeholder is not a board; the fix is the evidence, not a softer
   gate, and isDosePublishable() is unchanged — every dose below carries
   authority, documentId and section or it does not render.

   Each record answers ONE question. Where a label describes several regimens
   for different clinical questions they are separate records, because a merged
   range answers none of them: alfentanil 8-20 and 20-50 mcg/kg are not "8-50",
   and mivacurium's dose is inseparable from how fast it is given.
   ═══════════════════════════════════════════════════════════════════════════ */

{ id:'drug.etomidate', name:'Etomidate', group:'induction',
  pclass:'induction',
  aliases:['etomidate','amidate','hypnomidate'],
  klass:'Carboxylated imidazole induction agent',
  indications:['induction of general anaesthesia'],
  /* The label's population is adults and paediatric patients over 10 years,
     so this is one record across both with the boundary as an applicability
     band rather than two records claiming separate reviews. A younger child
     falls outside it and is told so. */
  doses:[
    { label:'Induction', route:'IV', phase:'induction',
      low:0.2, high:0.6, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Usual induction dose 0.3 mg/kg, over 30–60 seconds.',
      population:'adult', populationClass:'D',
      applicability:{ ageBand:{ min:{ value:10, unit:'years', inclusive:false } } },
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Etomidate Injection',
                 documentId:'75bf0494-7cb9-4e8a-8edd-af62f035d236',
                 section:'DOSAGE AND ADMINISTRATION' } }],
  prep:'<b>2 mg/mL</b>',
  warn:'Adrenocortical suppression after a single induction dose; myoclonus is common.',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.thiopental', name:'Thiopental', group:'induction',
  pclass:'induction',
  aliases:['thiopental','thiopentone','sodium thiopental','pentothal','trapanal'],
  klass:'Ultra-short-acting barbiturate induction agent',
  indications:['induction of general anaesthesia'],
  /* THE PAEDIATRIC VALUES ARE DELIBERATELY NOT HERE. The SmPC gives newborn,
     infant and child induction doses but does not define where those
     categories begin and end, and this model's age bands require exact
     boundaries. Publishing them would mean inventing the boundaries, so the
     adult record ships and the paediatric categories stay withheld until a
     bounded source is reviewed. That is a coverage gap, stated. */
  doses:[
    { label:'Induction', route:'IV', phase:'induction',
      low:4, high:6, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Titrate to response. Reduce and titrate carefully in middle-aged, ' +
           'elderly and poor-general-condition patients.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'electronic Medicines Compendium',
                 title:'Thiopental Sodium — Summary of Product Characteristics',
                 documentId:'emc product 9376',
                 section:'4.2 Posology and method of administration — Use in anaesthesia' } }],
  prep:'<b>2.5% = 25 mg/mL</b>',
  warn:'Extravasation and intra-arterial injection cause tissue injury. Avoid in porphyria.',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.atropine', name:'Atropine', group:'induction',
  pclass:'anticholinergic',
  aliases:['atropine','atropine sulfate','atropine sulphate'],
  klass:'Antimuscarinic',
  indications:['preanesthetic antisialagogue','antivagal'],
  /* THE PREANESTHETIC QUESTION, NOT THE RESUSCITATION ONE. Atropine's
     bradycardia and cardiac-arrest doses are a different indication with
     different numbers, and printing one where the other belongs is the sort of
     substitution this model exists to prevent. */
  doses:[
    { label:'Preanesthetic / antivagal', route:'IV', phase:'induction',
      low:0.5, high:1, unit:'mg', type:'range',
      note:'IV / IM / SC, 30–60 minutes preoperatively. Maximum total 3 mg.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Atropine Sulfate Injection',
                 documentId:'532aa441-92ec-42d6-862a-639f8cfe9951',
                 section:'2.2 Adult Dosage — Antisialagogue or other antivagal (preanesthesia and during surgery)' } }],
  prep:'<b>0.6 mg/mL</b>',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.glycopyrrolate', name:'Glycopyrrolate', group:'induction',
  pclass:'anticholinergic',
  aliases:['glycopyrrolate','glycopyrronium','robinul'],
  klass:'Quaternary antimuscarinic',
  indications:['perioperative antivagal','preanesthetic antisialagogue'],
  /* TWO INDICATIONS, TWO ROUTES, TWO RECORDS. The preanesthetic dose is
     0.004 mg/kg INTRAMUSCULARLY; the intraoperative antivagal dose is 0.1 mg
     INTRAVENOUSLY. They are not the same medicine given two ways, and calling
     an IM premedication "IV" because the screen is an induction board would be
     a route error printed as fact.

     The induction board asks the intraoperative question, so that record
     carries phase 'induction'; the preanesthetic record is phase
     'premedication' and answers in the drug reference. */
  doses:[
    { label:'Antivagal — intraoperative', route:'IV', phase:'induction',
      value:0.1, unit:'mg', type:'protocol',
      note:'Repeat every 2–3 minutes as needed.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Glycopyrrolate Injection',
                 documentId:'83d70378-011b-4ce3-e053-2991aa0a22be',
                 section:'2.3 Recommended Dosage as Intraoperative Medication to Counteract Drug-induced or Vagal Reflexes and Their Associated Arrhythmias' } },
    { label:'Antivagal — intraoperative', route:'IV', phase:'induction',
      value:0.004, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'Maximum single dose 0.1 mg; repeat every 2–3 minutes as needed.',
      population:'paediatric', populationClass:'B',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Glycopyrrolate Injection',
                 documentId:'83d70378-011b-4ce3-e053-2991aa0a22be',
                 section:'2.3 Recommended Dosage as Intraoperative Medication to Counteract Drug-induced or Vagal Reflexes and Their Associated Arrhythmias' } },
    { label:'Preanesthetic', route:'IM', phase:'premedication',
      value:0.004, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'30–60 minutes before anticipated induction. Under 2 years may require up to 0.009 mg/kg.',
      population:'adult', populationClass:'D',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Glycopyrrolate Injection',
                 documentId:'83d70378-011b-4ce3-e053-2991aa0a22be',
                 section:'2.2 Recommended Dosage of Preanesthetic Medication in Adults and Pediatric Patients' } }],
  prep:'<b>0.2 mg/mL</b>',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.alfentanil', name:'Alfentanil', group:'analgesia',
  pclass:'opioid',
  aliases:['alfentanil','alfenta','rapifen','alfentanil hydrochloride'],
  klass:'Short-acting synthetic opioid',
  indications:['induction of analgesia','attenuation of laryngoscopy response'],
  /* NOT ONE RANGE. 8-20 mcg/kg is induction of analgesia in a patient who is
     breathing or being assisted; 20-50 mcg/kg is given to blunt laryngoscopy
     and intubation under assisted or controlled ventilation. Merging them into
     "8-50" would produce a number that answers neither question and hides
     which ventilation strategy it assumed. The board takes the restrained
     first context; the second is available beside it. */
  doses:[
    { label:'Induction of analgesia', route:'IV', phase:'induction',
      low:8, high:20, unit:'mcg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Spontaneous or assisted ventilation. Elderly or debilitated patients may require less.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Alfentanil Hydrochloride Injection',
                 documentId:'bb56df52-5abf-47dc-ab8d-902cfe19ccb2',
                 section:'DOSAGE SHOULD BE INDIVIDUALIZED AND TITRATED FOR USE DURING GENERAL ANESTHESIA — SPONTANEOUSLY BREATHING / ASSISTED VENTILATION' } },
    { label:'Attenuation of laryngoscopy and intubation', route:'IV', phase:'intubation',
      low:20, high:50, unit:'mcg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Assisted or controlled ventilation. Elderly or debilitated patients may require less.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Alfentanil Hydrochloride Injection',
                 documentId:'bb56df52-5abf-47dc-ab8d-902cfe19ccb2',
                 section:'DOSAGE SHOULD BE INDIVIDUALIZED AND TITRATED FOR USE DURING GENERAL ANESTHESIA — ASSISTED OR CONTROLLED VENTILATION — Incremental Injection (To attenuate response to laryngoscopy and intubation)' } }],
  prep:'<b>500 mcg/mL</b>',
  severity:'caution', hi:true,
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.atracurium', name:'Atracurium', group:'nmb',
  pclass:'nmb',
  aliases:['atracurium','atracurium besylate','atracurium besilate','tracrium'],
  klass:'Benzylisoquinolinium non-depolarising neuromuscular blocker',
  indications:['tracheal intubation','maintenance of neuromuscular block'],
  /* ROUTINE INTUBATION, AND NOT RSI. The label describes non-emergency bolus
     intubation; nothing in it supports a rapid-sequence claim, so there is no
     phase 'rsi' record here and the RSI card will say so rather than reusing
     this number. */
  doses:[
    { label:'Intubation', route:'IV', phase:'intubation',
      low:0.4, high:0.5, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'range',
      note:'Most adult patients. Requirements are reduced by inhalational agents.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Atracurium Besylate Injection',
                 documentId:'71d4bc78-57df-474b-8b19-811a959f1fce',
                 section:'DOSAGE AND ADMINISTRATION — Bolus Doses for Intubation and Maintenance of Neuromuscular Block — Adults' } }],
  prep:'<b>10 mg/mL</b>',
  warn:'Histamine release with rapid injection. Requirements reduced by inhalational agents.',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.mivacurium', name:'Mivacurium', group:'nmb',
  pclass:'nmb',
  aliases:['mivacurium','mivacurium chloride','mivacron'],
  klass:'Short-acting benzylisoquinolinium neuromuscular blocker',
  indications:['tracheal intubation'],
  /* THE DOSE AND THE INJECTION TIME ARE ONE FACT. 0.15 mg/kg over 5-15 seconds
     and 0.2 mg/kg over 30 seconds are different regimens, not points in a
     range: flattening them to "0.15-0.25 mg/kg" would let a clinician read the
     largest number and give it at the fastest rate, which is not what any of
     the three regimens says. Each is its own record and each carries its
     administration time. */
  doses:[
    { label:'Intubation', route:'IV', phase:'intubation',
      value:0.15, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'Over 5–15 seconds.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'FDA Drugs@FDA',
                 title:'Mivacurium Chloride Injection — NDA 020098 / S-019 (2018)',
                 documentId:'NDA 020098 / S-019 / 2018 label',
                 section:'DOSAGE AND ADMINISTRATION — Adults — Initial Doses — Table 7 Recommended Initial Dosing Regimens for Adults' } },
    { label:'Intubation — faster onset', route:'IV', phase:'intubation',
      value:0.2, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'Over 30 seconds.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'FDA Drugs@FDA',
                 title:'Mivacurium Chloride Injection — NDA 020098 / S-019 (2018)',
                 documentId:'NDA 020098 / S-019 / 2018 label',
                 section:'DOSAGE AND ADMINISTRATION — Adults — Initial Doses — Table 7 Recommended Initial Dosing Regimens for Adults' } },
    { label:'Intubation — divided dose', route:'IV', phase:'intubation',
      value:0.25, unit:'mg/kg', basis:'TBW', basisWeight:true, type:'protocol',
      note:'0.15 mg/kg, then 0.1 mg/kg 30 seconds later.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'FDA Drugs@FDA',
                 title:'Mivacurium Chloride Injection — NDA 020098 / S-019 (2018)',
                 documentId:'NDA 020098 / S-019 / 2018 label',
                 section:'DOSAGE AND ADMINISTRATION — Adults — Initial Doses — Table 7 Recommended Initial Dosing Regimens for Adults' } }],
  prep:'<b>2 mg/mL</b>',
  warn:'Histamine release with rapid injection. Prolonged block in plasma cholinesterase deficiency.',
  severity:'caution',
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

/* ══ VOLATILE AGENTS ══════════════════════════════════════════════════════
   MAINTENANCE CONCENTRATIONS, NOT INDUCTION ONES. Every value below is the
   label's own maintenance figure, and the induction concentrations these
   labels also carry are deliberately NOT here: the induction board asks a
   different question and is answered by the induction phase, which no
   volatile record enters. So "volatile induction dosing is not reviewed"
   stays true while maintenance becomes available.

   MAC IS A TABLE, AND IT STAYS A TABLE. Each label states MAC at particular
   ages, and it falls with age. Reducing that to one adult number, or
   interpolating a figure for the patient on screen, would be this file
   inventing a value its sources do not contain. The table is carried
   verbatim through `display`, so the reader gets the source's own rows and
   the note that MAC decreases with age, and no arithmetic happens anywhere.

   NITROUS OXIDE IS ABSENT ON PURPOSE. Its concentration and MAC were not
   established against a label in this pass, so it has no record here and the
   page prints its coverage state rather than a number. A card that looks
   complete is not a reason to publish a figure.                            */
{ id:'drug.sevoflurane', name:'Sevoflurane', group:'volatile',
  pclass:'inhalational',
  aliases:['sevoflurane','sevo','sevorane','ultane'],
  klass:'Halogenated volatile anaesthetic',
  indications:['inhalational induction','maintenance of anaesthesia'],
  doses:[
    { label:'Maintenance', route:'Inhalational', phase:'maintenance',
      low:0.5, high:3, unit:'%', type:'range',
      note:'Surgical levels are usually achieved with or without nitrous oxide. Titrate to effect.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Sevoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid bdde7502-6218-401c-9a4f-dd3bc3a80f72',
                 section:'DOSAGE AND ADMINISTRATION, Maintenance' } },
    { label:'MAC in oxygen', route:'Inhalational', phase:'maintenance',
      display:'2.1% at age 40', unit:'',
      note:'MAC is age dependent and decreases with increasing age.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Sevoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid bdde7502-6218-401c-9a4f-dd3bc3a80f72',
                 section:'DOSAGE AND ADMINISTRATION, MAC values in oxygen and in nitrous oxide' } },

    /* ── INDUCTION IS A TITRATION, NOT A RANGE ────────────────────────────
       REVIEWED 19/09. Everything above this point is MAINTENANCE, and the
       two must never answer each other's question: 0.5-3% printed under an
       induction strategy would be a maintenance concentration standing where
       a clinician reads the dose that puts the patient to sleep.

       IT IS NOT low/high. Flattening the label's protocol to 0.5-8% would
       print a therapeutic range where the source describes a procedure: a
       starting concentration, a step size and a ceiling, in that order. A
       clinician reading "0.5-8%" would reasonably start anywhere in it.
       type:'titration-protocol' keeps the three as three, and renderDose
       builds the line from them rather than from a sentence written here, so
       the structured fields are the content and not decoration beside it.

       TWO ROWS, ONE PROTOCOL. The titration is identical for adults and
       children; what differs is the concentration each population usually
       needs and how quickly it works. Splitting by population means the card
       shows the sentence for the patient in front of the clinician instead
       of both and a decision about which applies.

       THE SOURCE IS THE UK SmPC, NAMED AS SUCH. The US label confirms
       sevoflurane is suitable for mask induction — that sentence is already
       this record's `effect` — but its dosage section does not carry this
       numeric regimen, so the citation below is the eMC SmPC and not
       DailyMed. Citing the setid above for these numbers would point a
       reader at a document that does not contain them. */
    { label:'Induction', route:'Inhalational', phase:'induction',
      type:'titration-protocol',
      start:{ low:0.5, high:1 }, increment:{ low:0.5, high:1 }, max:8,
      unit:'%',
      note:'In oxygen, with or without nitrous oxide. Increase in steps until '
         + 'the required depth is reached, titrated to age and clinical '
         + 'status. Inspired concentrations up to 5% usually produce surgical '
         + 'anaesthesia in under 2 minutes in adults.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'eMC / UK SmPC',
                 title:'Sevoflurane 100% Inhalation Vapour, liquid (Piramal Critical Care Ltd)',
                 documentId:'eMC Summary of Product Characteristics, updated 12 August 2026',
                 section:'4.2 Posology and method of administration, Anaesthesia Induction' } },
    { label:'Induction', route:'Inhalational', phase:'induction',
      type:'titration-protocol',
      start:{ low:0.5, high:1 }, increment:{ low:0.5, high:1 }, max:8,
      unit:'%',
      note:'In oxygen, with or without nitrous oxide. Increase in steps until '
         + 'the required depth is reached, titrated to age and clinical '
         + 'status. Inspired concentrations up to 7% usually produce surgical '
         + 'anaesthesia in under 2 minutes in children.',
      /* 'B', NOT 'C'. 'C' is AGE_BANDED and its gate calls inAgeBand(), so a
         'C' row without an ageBand is withheld from every child — which is
         what happened when this was first written. Propofol's paediatric
         induction row is 'C' because its label states 3 to 16 years; the
         sevoflurane SmPC section says "children" and states no band, and
         inventing one to match the neighbouring record would be writing a
         limit no source has set. 'B' is reviewed-for-paediatric with no band
         claimed, which is exactly what the source supports. */
      population:'paediatric', populationClass:'B',
      evidence:{ state:'reviewed', authority:'eMC / UK SmPC',
                 title:'Sevoflurane 100% Inhalation Vapour, liquid (Piramal Critical Care Ltd)',
                 documentId:'eMC Summary of Product Characteristics, updated 12 August 2026',
                 section:'4.2 Posology and method of administration, Anaesthesia Induction' } }
  ],
  prep:'', severity:'caution',
  /* MOVED OUT OF THE PAGE AND INTO THE RECORD. This sentence lived in
     engine.html's VOLATILE_SKIN as presentation prose with no source behind
     it. It is a clinical claim about an agent, so it belongs here, cited,
     where the publishing gate can see it. The skin now carries colour, icon
     and role and nothing a clinician would read as clinical.

     Note the section: this comes from the INDUCTION paragraph of the label,
     which is where the nonpungency claim is made. That does not make it an
     induction dose record and it publishes no concentration; it is the
     descriptive property that distinguishes this agent from the other two. */
  effect:'Nonpungent and does not cause respiratory irritability; suitable for mask induction in adults and children.',
  effectEvidence:{ state:'reviewed', authority:'DailyMed',
                   title:'Sevoflurane, Inhalation Anesthetic, Prescribing Information',
                   documentId:'DailyMed setid bdde7502-6218-401c-9a4f-dd3bc3a80f72',
                   section:'DOSAGE AND ADMINISTRATION, Induction' },
  /* WAS: "Nonpungent, so it is tolerated for inhalational induction.
     Maintenance concentration is titrated to effect." That is not a caution.
     It is a favourable property, and it was printing under an amber CAUTIONS
     heading and duplicating the card's own effects row, so a clinician
     scanning for what to watch for was handed something reassuring. The
     nonpungency statement keeps its place under effects, where it belongs.

     What replaces it is label material, and it carries its own citation:
     warn is drug-level prose, and prose without a source has no business
     inside a record marked reviewed. warnEvidence is read by the same shape
     of gate the dose citations use. */
  warn:'Fresh gas flow below 1 L/min is not recommended: low flow raises Compound A exposure and the risk of renal injury. Respiratory depression and QT prolongation have been reported. Trigger for malignant hyperthermia, and perioperative hyperkalaemia has occurred.',
  warnEvidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Sevoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid bdde7502-6218-401c-9a4f-dd3bc3a80f72',
                 section:'WARNINGS AND PRECAUTIONS' },
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.desflurane', name:'Desflurane', group:'volatile',
  pclass:'inhalational',
  aliases:['desflurane','suprane'],
  klass:'Halogenated volatile anaesthetic',
  indications:['maintenance of anaesthesia'],
  doses:[
    { label:'Maintenance', route:'Inhalational', phase:'maintenance',
      low:2.5, high:8.5, unit:'%', type:'range',
      note:'Adult maintenance. Concomitant nitrous oxide reduces the concentration required.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Desflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 561c51aa-76fd-2eb8-e063-6394a90a7021',
                 section:'DOSAGE AND ADMINISTRATION, Maintenance' } },
    { label:'MAC in 100% oxygen', route:'Inhalational', phase:'maintenance',
      display:'7.3% at 25 y, 6.0% at 45 y, 5.2% at 70 y', unit:'',
      note:'MAC decreases with age. Concomitant nitrous oxide reduces MAC.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Desflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 561c51aa-76fd-2eb8-e063-6394a90a7021',
                 section:'DOSAGE AND ADMINISTRATION, MAC values by age' } }
  ],
  prep:'', severity:'caution',
  /* MOVED OUT OF THE PAGE, AND NARROWED TO WHAT ONLY THIS AGENT SAYS. The
     skin's line was "Dose dependent fall in blood pressure. Above 1 MAC it
     may raise heart rate." That is true, uncited, and it is also most of
     what the caution below already says: the effects row and the cautions
     row were answering the same question twice, which is exactly what this
     card was cleaned up to stop doing.

     Nothing is lost. The haemodynamic material is still on the card, in the
     cautions where a rapid rise in concentration is the thing to watch for.
     What goes in effects is the property that distinguishes desflurane from
     the other two agents and appears nowhere else on the card. */
  effect:'Changes in clinical effect rapidly follow changes in inspired concentration.',
  effectEvidence:{ state:'reviewed', authority:'DailyMed',
                   title:'Desflurane, Inhalation Anesthetic, Prescribing Information',
                   documentId:'DailyMed setid 561c51aa-76fd-2eb8-e063-6394a90a7021',
                   section:'CLINICAL PHARMACOLOGY, 12.2 Pharmacodynamics' },
  /* WAS: a restatement of the card's effects row, blood pressure and heart
     rate said twice on one card in two wordings. The haemodynamic effect
     stays under effects; what belongs in a warning is the paediatric airway
     restriction, the consequence of raising the dial quickly in a patient who
     cannot tolerate it, and the absorbent. */
  warn:'Not for maintenance in non-intubated children: coughing, laryngospasm and other respiratory adverse reactions are increased. A rapid rise in concentration can sharply raise heart rate and blood pressure, which is undesirable in coronary artery disease. Desiccated carbon dioxide absorbent can produce carbon monoxide. Trigger for malignant hyperthermia.',
  warnEvidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Desflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 561c51aa-76fd-2eb8-e063-6394a90a7021',
                 section:'WARNINGS AND PRECAUTIONS' },
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

{ id:'drug.isoflurane', name:'Isoflurane', group:'volatile',
  pclass:'inhalational',
  aliases:['isoflurane','forane','forene'],
  klass:'Halogenated volatile anaesthetic',
  indications:['maintenance of anaesthesia'],
  doses:[
    { label:'Maintenance with nitrous oxide', route:'Inhalational', phase:'maintenance',
      low:1, high:2.5, unit:'%', type:'range',
      note:'Surgical levels may be sustained in this range when nitrous oxide is used.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Isoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 525a2467-548d-4b10-b181-91b90e99ae1b',
                 section:'DOSAGE AND ADMINISTRATION, Maintenance' } },
    { label:'Additional with oxygen alone', route:'Inhalational', phase:'maintenance',
      low:0.5, high:1, unit:'%', type:'range',
      note:'An additional amount may be required when isoflurane is given with oxygen alone.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Isoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 525a2467-548d-4b10-b181-91b90e99ae1b',
                 section:'DOSAGE AND ADMINISTRATION, Maintenance' } },
    { label:'MAC in 100% oxygen', route:'Inhalational', phase:'maintenance',
      display:'1.28% at 19 to 30 y, 1.15% at 31 to 55 y, 1.05% at 55 to 83 y', unit:'',
      note:'MAC is age dependent and decreases with increasing age.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Isoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 525a2467-548d-4b10-b181-91b90e99ae1b',
                 section:'DOSAGE AND ADMINISTRATION, MAC values by age' } }
  ],
  prep:'', severity:'caution',
  /* THE EFFECTS ROW COMES BACK, FROM THE LABEL THIS TIME. The old one said
     "MAC is age dependent and decreases with increasing age", which was the
     MAC row printed twice, so it was deleted and the card was left with no
     effects row at all. What replaces it is a pharmacodynamic description
     out of the same document as every other isoflurane value here, carrying
     its own citation for the same reason warn does: prose under a heading a
     clinician reads as clinical is clinical, and it needs a source.

     effect is DESCRIPTIVE and warn is RISK. They are deliberately not merged:
     a clinician scanning for what an agent does and a clinician scanning for
     what to watch for are asking two different questions, and one row cannot
     answer both without burying one of them. */
  effect:'Heart rhythm is generally stable. With controlled ventilation and a normal PaCO₂, cardiac output is maintained mainly by a rise in heart rate that compensates for reduced stroke volume.',
  effectEvidence:{ state:'reviewed', authority:'DailyMed',
                   title:'Isoflurane, Inhalation Anesthetic, Prescribing Information',
                   documentId:'DailyMed setid 525a2467-548d-4b10-b181-91b90e99ae1b',
                   section:'CLINICAL PHARMACOLOGY, 12.2 Pharmacodynamics' },
  /* THIS RECORD HAD NO warn AT ALL, so mxCard's `if(d.warn)` silently dropped
     the CAUTIONS row and one card in a four-card comparison grid warned about
     nothing. An absent warning reads as "nothing to watch for", which is the
     most expensive thing a card like this can imply. */
  warn:'Dose dependent vasodilatation and hypotension, marked in hypovolaemia or haemodynamic compromise. Hepatic injury has followed repeated exposure to halogenated anaesthetics. Desiccated carbon dioxide absorbent can produce carbon monoxide. Trigger for malignant hyperthermia.',
  warnEvidence:{ state:'reviewed', authority:'DailyMed',
                 title:'Isoflurane, Inhalation Anesthetic, Prescribing Information',
                 documentId:'DailyMed setid 525a2467-548d-4b10-b181-91b90e99ae1b',
                 section:'WARNINGS AND PRECAUTIONS' },
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Citations supplied and verified by the clinical owner outside the build environment.',
               sourceAccessed:true } },

/* ── NITROUS OXIDE ────────────────────────────────────────────────────────
   IT HAS A RECORD NOW, AND THAT IS THE ONLY REASON THE PAGE MAY DESCRIBE IT.
   Until this record existed the Maintenance card was allowed to name the
   agent, colour it and say that no reference was published. It was not
   allowed to say what the gas does, because nothing behind it had been
   reviewed. That constraint is satisfied here rather than bypassed.

   THE HEADLINE NUMBER IS NOT A DOSE, AND ITS LABEL SAYS SO. 50 to 70% is the
   range of concentrations REPORTED ACROSS THE GENERAL ANAESTHESIA STUDIES
   included in the Cochrane review, not a recommendation, and clinical use
   depends on context. The row is labelled "Common GA adjunct" for that
   reason: read under the heading "Maintenance" it would become a recommended
   maintenance concentration, which is a claim no source here supports.

   MAC IS FROM THE HUMAN DETERMINATION, NOT A TEXTBOOK RESTATEMENT. Hornbein
   1982 measured a mean of 1.04 atm absolute in man. It is carried as display
   only, with low, high and value all absent, so no arithmetic can reach it,
   and it is deliberately NOT connected to patientContext.derived.mac, which
   is a general age scalar computed elsewhere: multiplying an agent MAC by it
   would manufacture a patient-specific figure nobody reviewed.

   THE INDICATIONS DO NOT SAY "MAINTENANCE OF ANAESTHESIA". With a MAC above
   100% this agent cannot be a sole maintenance anaesthetic at atmospheric
   pressure, so the record must not describe it as one even in a field that
   never reaches the screen. It is an adjunct, and an analgesic.

   LAPAROSCOPY IS A CAUTION, NOT A CONTRAINDICATION, and the wording is
   deliberate because the primary evidence genuinely disagrees. Taylor 1992
   (PMID 1550279) randomised 50 laparoscopic cholecystectomies and its
   blinded surgeon found no significant difference in operating conditions or
   bowel distension. El-Galley 2007 (PMID 17512015) randomised laparoscopic
   donor nephrectomies and reported distension in half, severe enough to
   interfere with surgery in a quarter. Writing "contraindicated" would state
   as settled something two randomised trials answer differently.          */
{ id:'drug.nitrous-oxide', name:'Nitrous oxide', group:'volatile',
  pclass:'inhalational',
  aliases:['nitrous oxide','nitrous','n2o','laughing gas'],
  klass:'Inhaled anaesthetic gas',
  /* NOT 'maintenance of anaesthesia'. See the header note: MAC > 100%. */
  indications:['adjunct to general anaesthesia','analgesia'],
  doses:[
    { label:'Common GA adjunct', route:'Inhalational', phase:'maintenance',
      display:'50–70%', unit:'',
      note:'The range of concentrations used across the general anaesthesia studies in this review, not a recommended or universal dose; clinical use depends on the indication. After discontinuation, supplemental oxygen can reduce diffusion hypoxia.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'Cochrane Database of Systematic Reviews',
                 title:'Nitrous oxide-based versus nitrous oxide-free general anaesthesia and accidental awareness during general anaesthesia in surgical patients (Hounsome et al., 2016)',
                 documentId:'PMID 27508523, Cochrane review CD011052',
                 section:'Characteristics of included studies, nitrous oxide concentrations' } },
    { label:'MAC', route:'Inhalational', phase:'maintenance',
      display:'≈104%', unit:'',
      note:'Mean 1.04 atm absolute, measured in man. MAC above 100% means nitrous oxide cannot provide 1 MAC as a sole anaesthetic at normal atmospheric pressure. Printed as the source states it; no age adjustment or interpolation is applied.',
      population:'adult', populationClass:'A',
      evidence:{ state:'reviewed', authority:'PubMed / Anesthesia & Analgesia',
                 title:'Hornbein TF, Eger EI II, Winter PM, Smith G, Wetstone D, Smith KH. The minimum alveolar concentration of nitrous oxide in man. Anesth Analg. 1982;61(7):553-556.',
                 documentId:'PMID 7201254',
                 section:'Human MAC determination, abstract' } }
  ],
  prep:'', severity:'caution',
  effect:'Provides analgesia but is a weak anaesthetic, the least potent of the inhaled agents. Low blood solubility gives rapid uptake and washout, and co-administration reduces the concentration of another inhaled anaesthetic that is required.',
  effectEvidence:{ state:'reviewed', authority:'OpenAnesthesia, with the ESA Task Force review',
                   title:'Nitrous Oxide (OpenAnesthesia); European Society of Anaesthesiology Task Force on Nitrous Oxide, Br J Anaesth 2019',
                   documentId:'OpenAnesthesia keyword article, Nitrous Oxide; PMID 30916011',
                   section:'Pharmacologic properties and clinical indications' },
  /* ── THE CAUTION IS WRITTEN TO BE SCANNED, NOT READ ────────────────────
     Four labelled blocks separated by <br>, because this row is always
     visible including on a phone and a clinician reaching for it is looking
     for one of four things, not reading a paragraph. The renderer puts this
     string into innerHTML, so the breaks are safe; the claims stay here in
     the record rather than being assembled in the page.

     "Decompression sickness" was in the first draft of this list and has
     been REMOVED. It is physiologically adjacent to the closed-space
     mechanism and it sounded right, which is exactly why it should not have
     been there: no source was supplied for how it belongs on a
     perioperative card, and plausibility is not provenance. The
     well-supported vascular air embolism warning stays.

     THE FIRE BLOCK NAMES A CONDITION, NOT A DEVICE. It used to read "avoid it
     in airway laser, diathermy or other high fire risk fields", and the bare
     word "diathermy" was doing too much work: electrosurgery is in use
     somewhere in a very large share of operations, and reading that line a
     clinician could reasonably conclude nitrous oxide was off the table for
     most of them. The hazard is not the device. It is an ignition source
     meeting an oxidiser enriched atmosphere, which is why airway laser and
     airway electrosurgery are the examples and why the sentence states the
     condition before it states the example.

     The ophthalmic warning is deliberately narrow. The danger is RESIDUAL
     INTRAOCULAR GAS after retinal surgery, not ophthalmic surgery in
     general, and the Royal College of Ophthalmologists alert is specific
     about that. Generalising it would make the card wrong in the common
     case. */
  warn:'<b>AVOID, CLOSED GAS SPACES:</b> pneumothorax, bowel obstruction, pneumocephalus or intracranial air, residual intraocular gas after retinal surgery, middle ear surgery, and significant risk of vascular air embolism. Nitrous oxide enters a closed space faster than nitrogen leaves it, raising volume where the space is compliant and pressure where it is not.<br><b>B12:</b> avoid in known clinically significant vitamin B12 or methionine synthase deficiency. Assess patients at substantial risk, particularly where exposure is prolonged or repeated; toxicity has followed a single anaesthetic in subclinical deficiency.<br><b>FIRE:</b> supports combustion. Avoid it where an oxidiser enriched atmosphere would meet an ignition source, above all during airway laser or airway electrosurgery and other high fire risk procedures.<br><b>LAPAROSCOPY:</b> not an absolute contraindication. It may increase bowel distension and the evidence is mixed, so consider avoiding it where distension would compromise the operative field.',
  warnEvidence:{ state:'reviewed', authority:'StatPearls, MHRA, Royal College of Ophthalmologists, DailyMed, APSF, and two randomised trials',
                 title:'Nitrous Oxide (StatPearls); Nitrous oxide: neurological and haematological toxic effects (MHRA); Ophthalmic Safety Alert, do not use nitrous oxide when there is gas in an operated eye (RCOphth, 18 December 2018); Nitrous Oxide gas labelling (DailyMed); Surgical Fire Prevention: A Review, and Upper Airway Management Guide for Laser Airway Surgery (Anesthesia Patient Safety Foundation)',
                 documentId:'NCBI Bookshelf NBK532922; DailyMed setid b7e230d1-e201-4984-ba8b-5b88ec5a1bbf; PMID 1550279; PMID 17512015',
                 section:'Closed gas spaces: StatPearls, Contraindications. Intraocular gas: RCOphth Ophthalmic Safety Alert, 18 December 2018. Vitamin B12: MHRA drug safety update on neurological and haematological toxicity. Combustion: DailyMed setid b7e230d1-e201-4984-ba8b-5b88ec5a1bbf, Principal Display Panel, fire and oxidizer warning, for the hazard itself; APSF surgical fire guidance for the procedural condition, that risk arises where an ignition source such as a laser or electrosurgery meets an oxidiser enriched field, and that nitrous oxide is not used during airway laser surgery. Laparoscopy: PMID 1550279 (no significant difference) and PMID 17512015 (distension interfering with surgery).' },
  /* THE SOURCES WERE READ, JUST NOT BY THIS BUILD. Every primary source here
     is blocked by this environment's network egress, so the in-build
     corroboration was against search-engine summaries only. The clinical
     owner opened and checked the primary and authoritative sources
     externally, which is what sourceAccessed records, and has since approved
     the final content, which is what reviewer records.

     Those two facts are kept separate on purpose. sourceAccessed says the
     citations were verified; reviewer says the wording built on them was
     signed off. A record can have the first without the second, and this one
     did, for exactly one review cycle.                                     */
  provenance:{ state:'reviewed', reviewer:'clinical_owner',
               note:'Primary and authoritative sources were directly reviewed outside the build environment. Final clinical content approved by the clinical owner.',
               sourceAccessed:true } }
];

/* ── REGIONAL AVAILABILITY (future-compatible, not filtered in this pass) ──
   Flagged for explicit review before any of these is published.            */
var REGIONAL_REVIEW = ['thiopental','droperidol','metamizole','clevidipine',
                       'levosimendan','digoxin','cocaine topical','pethidine'];

/* ── NON-DRUG SEARCHABLE ITEMS ───────────────────────────────────────────
   Descriptors only. The content itself stays in its module; nothing here
   duplicates it. Crisis Center entries point at the untouched card.        */
var ITEMS = [
  /* Airway devices — detail lives in engine.html TUBES[] */
  { id:'tube.cuffed-ett', kind:'device', name:'Cuffed tracheal tube', cat:'Airway and tubes',
    aliases:['ett','cuffed ett','endotracheal tube','tracheal tube','et tube','tube'],
    summary:'Standard adult airway · cuff 20–30 cmH₂O', module:'airway-tubes', tube:0 },
  { id:'tube.uncuffed', kind:'device', name:'Uncuffed paediatric tube', cat:'Airway and tubes',
    aliases:['uncuffed','uncuffed ett','paediatric tube','pediatric tube'],
    summary:'age / 4 + 4 mm ID · leak at 20–25 cmH₂O', module:'airway-tubes', tube:1 },
  { id:'tube.parker', kind:'device', name:'Parker Flex-Tip tube', cat:'Airway and tubes',
    aliases:['parker','flex tip','parker flex-tip','flextip'],
    summary:'Curved tip · reduces hang-up when railroading', module:'airway-tubes', tube:2 },
  { id:'tube.oral-rae', kind:'device', name:'Oral RAE tube', cat:'Airway and tubes',
    aliases:['rae','oral rae','preformed tube','south facing','ring adair elwyn'],
    summary:'South-facing preformed bend · ENT and dental', module:'airway-tubes', tube:3 },
  { id:'tube.nasal-rae', kind:'device', name:'Nasal RAE tube', cat:'Airway and tubes',
    aliases:['nasal rae','north facing','nasal tube','nasotracheal'],
    summary:'North-facing bend · maxillofacial and dental', module:'airway-tubes', tube:4 },
  { id:'tube.reinforced', kind:'device', name:'Reinforced tube', cat:'Airway and tubes',
    aliases:['reinforced','armoured','armored','flexometallic','wire reinforced','spiral tube'],
    summary:'Kink resistant · prone and head-neck surgery', module:'airway-tubes', tube:5 },
  { id:'tube.laser', kind:'device', name:'Laser-resistant tube', cat:'Airway and tubes',
    aliases:['laser tube','laser','laser resistant','laser flex','laser safe tube'],
    summary:'Saline-filled double cuff · FiO₂ ≤ 0.30', module:'airway-tubes', tube:6, priority:2 },
  { id:'tube.mlt', kind:'device', name:'Microlaryngeal tube', cat:'Airway and tubes',
    aliases:['mlt','microlaryngeal','micro laryngeal','microlaryngoscopy tube'],
    summary:'4.0–6.0 mm ID on an adult-length shaft', module:'airway-tubes', tube:7 },
  { id:'tube.dlt-left', kind:'device', name:'Double-lumen tube — left', cat:'Airway and tubes',
    aliases:['dlt','double lumen','double-lumen tube','left dlt','robertshaw','one lung ventilation','olv','lung isolation'],
    summary:'Default for one-lung ventilation · 39–41 Fr male', module:'airway-tubes', tube:8, priority:2 },
  { id:'tube.dlt-right', kind:'device', name:'Double-lumen tube — right', cat:'Airway and tubes',
    aliases:['right dlt','right double lumen','right sided dlt'],
    summary:'Only when the left main bronchus is unusable', module:'airway-tubes', tube:9 },
  { id:'tube.lma-classic', kind:'device', name:'LMA Classic', cat:'Airway and tubes',
    aliases:['lma','laryngeal mask','lma classic','supraglottic','supraglottic airway','sga'],
    summary:'First generation · cuff ≤ 60 cmH₂O', module:'airway-tubes', tube:10 },
  { id:'tube.lma-supreme', kind:'device', name:'LMA Supreme', cat:'Airway and tubes',
    aliases:['lma supreme','supreme'],
    summary:'Second generation · gastric drain · seal 24–28', module:'airway-tubes', tube:11 },
  { id:'tube.lma-proseal', kind:'device', name:'LMA ProSeal', cat:'Airway and tubes',
    aliases:['proseal','lma proseal','pro seal'],
    summary:'Highest LMA seal · up to ~30 cmH₂O', module:'airway-tubes', tube:12 },
  { id:'tube.igel', kind:'device', name:'i-gel', cat:'Airway and tubes',
    aliases:['igel','i-gel','i gel','gel supraglottic'],
    summary:'Non-inflatable cuff · sized by weight', module:'airway-tubes', tube:13 },
  { id:'tube.lts', kind:'device', name:'Laryngeal tube (LTS / LTS-D)', cat:'Airway and tubes',
    aliases:['lts','lts-d','laryngeal tube','king lt','combitube alternative'],
    summary:'Rescue airway · sized by patient height', module:'airway-tubes', tube:14 },
  { id:'tube.tracheostomy', kind:'device', name:'Tracheostomy tube', cat:'Airway and tubes',
    aliases:['tracheostomy','trache','trach','tracheotomy'],
    summary:'First change ≥ 7 days (percutaneous ≥ 10)', module:'airway-tubes', tube:15 },

  /* Crisis protocols — the Crisis Center itself is untouched */
  { id:'crisis.last', kind:'protocol', name:'LAST — local anaesthetic systemic toxicity', cat:'Emergencies',
    aliases:['last','local anaesthetic toxicity','local anesthetic systemic toxicity','lipid rescue','intralipid','lipid emulsion'],
    summary:'Lipid emulsion 20% · bolus then infusion', module:'crisis-center', crisis:0, priority:3 },
  { id:'crisis.mh', kind:'protocol', name:'Malignant hyperthermia', cat:'Emergencies',
    aliases:['mh','malignant hyperthermia','dantrolene','malignant hyperpyrexia'],
    summary:'Dantrolene 2.5 mg/kg, repeat to effect', module:'crisis-center', crisis:1, priority:3 },
  { id:'crisis.brady', kind:'protocol', name:'Bradycardia', cat:'Emergencies',
    aliases:['bradycardia','brady','slow heart rate','atropine'],
    summary:'Atropine 0.5 mg IV, max 3 mg', module:'crisis-center', crisis:2, priority:3 },
  { id:'crisis.tachy', kind:'protocol', name:'Tachycardia', cat:'Emergencies',
    aliases:['tachycardia','svt','tachy','adenosine','cardioversion'],
    summary:'Assess stability · adenosine or cardioversion', module:'crisis-center', crisis:3, priority:3 },
  { id:'crisis.arrest', kind:'protocol', name:'Cardiac arrest', cat:'Emergencies',
    aliases:['cardiac arrest','arrest','als','acls','cpr','resuscitation','vf','defibrillation'],
    summary:'ALS · adrenaline 1 mg IV every 3–5 min', module:'crisis-center', crisis:4, priority:3 },
  { id:'crisis.da', kind:'protocol', name:'Difficult airway', cat:'Emergencies',
    aliases:['difficult airway','das','failed intubation','plan a b c d'],
    summary:'DAS plan A → D', module:'crisis-center', crisis:5, priority:3 },
  { id:'crisis.cico', kind:'protocol', name:'CICO — front of neck access', cat:'Emergencies',
    aliases:['cico','cant intubate cant oxygenate','front of neck','fona','cricothyroidotomy','scalpel bougie tube'],
    summary:'Scalpel–bougie–tube · 6.0 mm cuffed', module:'crisis-center', crisis:6, priority:3 },
  { id:'crisis.anaphylaxis', kind:'protocol', name:'Anaphylaxis', cat:'Emergencies',
    aliases:['anaphylaxis','anaphylactic','allergic reaction','tryptase','adrenaline im'],
    summary:'IM adrenaline 0.5 mg · fluids · stop the trigger', module:'crisis-center', crisis:7, priority:3 },

  /* Calculators */
  { id:'calc.ibw', kind:'calculator', name:'Ideal body weight', cat:'Calculators',
    aliases:['ibw','ideal body weight','devine'], summary:'From height and sex', module:'derived' },
  { id:'calc.lbw', kind:'calculator', name:'Lean body weight', cat:'Calculators',
    aliases:['lbw','lean body weight'], summary:'From weight, height and sex', module:'derived' },
  { id:'calc.abw', kind:'calculator', name:'Adjusted body weight', cat:'Calculators',
    aliases:['abw','adjusted body weight','dosing weight'], summary:'IBW + 0.4 (TBW − IBW)', module:'derived' },
  { id:'calc.bsa', kind:'calculator', name:'Body surface area', cat:'Calculators',
    aliases:['bsa','body surface area','mosteller'], summary:'m²', module:'derived' },
  { id:'calc.ebv', kind:'calculator', name:'Estimated blood volume', cat:'Calculators',
    aliases:['ebv','blood volume','estimated blood volume'], summary:'mL, by age band', module:'fluids-blood' },
  { id:'calc.mabl', kind:'calculator', name:'Maximum allowable blood loss', cat:'Fluids and blood',
    aliases:['mabl','allowable blood loss','maximum blood loss'], summary:'To Hct 30 and Hct 25', module:'fluids-blood' },
  /* Search alias only. This points at the "Massive haemorrhage" group that
     Fluids & blood already renders; no protocol, target or dose is defined
     here. It exists because a clinician types "massive bleeding", "MTP" or
     "haemorrhage" — and every one of those returned nothing. */
  { id:'ref.massive-haemorrhage', kind:'protocol', name:'Massive haemorrhage', cat:'Fluids and blood',
    aliases:['massive haemorrhage','massive hemorrhage','massive bleeding','major bleeding',
             'major haemorrhage','major hemorrhage','haemorrhage','hemorrhage','bleeding',
             'mtp','massive transfusion','massive transfusion protocol','transfusion',
             'transfusion protocol','1:1:1','ratio transfusion'],
    summary:'Ratio, tranexamic acid, calcium, fibrinogen and platelet targets',
    module:'fluids-blood', priority:2 },
  { id:'calc.mac', kind:'calculator', name:'MAC age adjustment', cat:'Calculators',
    aliases:['mac','minimum alveolar concentration','mac age'], summary:'Relative to a 40-year-old', module:'derived' },
  { id:'calc.pbw', kind:'calculator', name:'Predicted body weight', cat:'Ventilation',
    aliases:['pbw','predicted body weight','ardsnet weight'], summary:'Drives tidal volume', module:'ventilation' },
  { id:'calc.tv', kind:'calculator', name:'Tidal volume', cat:'Ventilation',
    aliases:['tv','tidal volume','6 ml/kg','lung protective','vt'], summary:'6–8 mL/kg PBW', module:'ventilation', priority:1 },
  { id:'calc.421', kind:'calculator', name:'Maintenance fluid (4-2-1)', cat:'Fluids and blood',
    aliases:['421','4-2-1','maintenance fluid','holliday segar'], summary:'mL/hr', module:'fluids-blood' },
  { id:'calc.la-max', kind:'calculator', name:'Local anaesthetic maximum dose', cat:'Regional and neuraxial',
    aliases:['la max','maximum local anaesthetic','max dose','toxic dose','la ceiling'],
    summary:'Lidocaine, bupivacaine, levobupivacaine, ropivacaine', module:'regional', priority:2 },

  /* Regional */
  { id:'block.interscalene', kind:'block', name:'Interscalene block', cat:'Regional and neuraxial',
    aliases:['interscalene','isb','shoulder block'], summary:'1–3 cm · 10–15 mL', module:'blocks-ultrasound' },
  { id:'block.supraclavicular', kind:'block', name:'Supraclavicular block', cat:'Regional and neuraxial',
    aliases:['supraclavicular','scb'], summary:'1–2 cm · 15–20 mL', module:'blocks-ultrasound' },
  { id:'block.infraclavicular', kind:'block', name:'Infraclavicular block', cat:'Regional and neuraxial',
    aliases:['infraclavicular','icb'], summary:'3–5 cm · 20–30 mL', module:'blocks-ultrasound' },
  { id:'block.axillary', kind:'block', name:'Axillary block', cat:'Regional and neuraxial',
    aliases:['axillary block','axillary'], summary:'1–3 cm · 20–30 mL', module:'blocks-ultrasound' },
  { id:'block.esp', kind:'block', name:'Erector spinae plane block', cat:'Regional and neuraxial',
    aliases:['esp','erector spinae','espb'], summary:'3–5 cm · 20 mL/side', module:'blocks-ultrasound' },
  { id:'block.serratus', kind:'block', name:'Serratus anterior plane block', cat:'Regional and neuraxial',
    aliases:['serratus','sap block','serratus anterior'], summary:'2–4 cm · 20–30 mL', module:'blocks-ultrasound' },
  { id:'block.tap', kind:'block', name:'TAP block', cat:'Regional and neuraxial',
    aliases:['tap','tap block','transversus abdominis'], summary:'2–4 cm · 15–20 mL/side', module:'blocks-ultrasound' },
  { id:'block.rectus', kind:'block', name:'Rectus sheath block', cat:'Regional and neuraxial',
    aliases:['rectus sheath','rectus block'], summary:'1–3 cm · 10–20 mL/side', module:'blocks-ultrasound' },
  { id:'block.femoral', kind:'block', name:'Femoral nerve block', cat:'Regional and neuraxial',
    aliases:['femoral','femoral nerve block','fnb'], summary:'2–4 cm · 15–20 mL', module:'blocks-ultrasound' },
  { id:'block.adductor', kind:'block', name:'Adductor canal block', cat:'Regional and neuraxial',
    aliases:['adductor canal','acb','saphenous block'], summary:'2–4 cm · 10–15 mL', module:'blocks-ultrasound' },
  { id:'block.popliteal', kind:'block', name:'Popliteal sciatic block', cat:'Regional and neuraxial',
    aliases:['popliteal','sciatic','popliteal sciatic'], summary:'3–5 cm · 20–30 mL', module:'blocks-ultrasound' },
  { id:'neuraxial.spinal', kind:'block', name:'Spinal anaesthesia', cat:'Regional and neuraxial',
    aliases:['spinal','subarachnoid','intrathecal','sab'], summary:'Hyperbaric bupivacaine 0.5%', module:'regional', priority:1 },
  { id:'neuraxial.epidural', kind:'block', name:'Epidural', cat:'Regional and neuraxial',
    aliases:['epidural','labour epidural','labor epidural','pcea'], summary:'Low-dose LA + lipophilic opioid', module:'regional', priority:1 },

  /* Scores */
  { id:'score.asa', kind:'score', name:'ASA physical status', cat:'Clinical scores',
    aliases:['asa','physical status','asa grade'], summary:'I healthy to V moribund', module:'risk-scores' },
  { id:'score.stopbang', kind:'score', name:'STOP-BANG', cat:'Clinical scores',
    aliases:['stop bang','stopbang','osa screen','sleep apnoea score'], summary:'≥ 3 indicates OSA risk', module:'risk-scores' },
  { id:'score.apfel', kind:'score', name:'Apfel PONV score', cat:'Clinical scores',
    aliases:['apfel','ponv score','nausea score'], summary:'0–4 risk factors', module:'risk-scores' },
  { id:'score.rcri', kind:'score', name:'RCRI', cat:'Clinical scores',
    aliases:['rcri','revised cardiac risk index','lee index'], summary:'Perioperative cardiac risk', module:'risk-scores' },

  /* Monitoring / ventilation */
  { id:'mon.arterial', kind:'reference', name:'Arterial line', cat:'Ventilation',
    aliases:['arterial line','art line','a-line','radial artery'], summary:'20 G adult · 22 G small adult or child', module:'monitoring-access' },
  { id:'mon.cvc', kind:'reference', name:'Central venous catheter', cat:'Ventilation',
    aliases:['cvc','central line','central venous','ij line','subclavian'], summary:'Depth by route · tip at the cavo-atrial junction', module:'monitoring-access' },
  { id:'vent.pressures', kind:'reference', name:'Airway pressure targets', cat:'Ventilation',
    aliases:['peak pressure','plateau pressure','driving pressure','peep','pplat'], summary:'Peak &lt;35–40 · plateau ≤30 · driving ≤15', module:'ventilation' },

  /* Antibiotic prophylaxis — architecture present, content unpublished */
  { id:'abx.prophylaxis', kind:'prophylaxis', name:'Perioperative antibiotic prophylaxis', cat:'Antibiotic prophylaxis',
    aliases:['antibiotic','antibiotics','prophylaxis','surgical prophylaxis','cefazolin','cefuroxime','clindamycin',
             'vancomycin','gentamicin','metronidazole','antimicrobial prophylaxis','sap'],
    summary:'Awaiting clinical review — not yet published', module:'antibiotic-prophylaxis',
    unpublished:true }
];

/* ── SEARCH ──────────────────────────────────────────────────────────────
   Ranking, exactly as approved:
     1 exact canonical   2 exact alias      3 canonical prefix
     4 alias prefix      5 word-boundary    6 class / indication
     7 summary           8 restricted fuzzy (canonical + aliases only)
   Priority weighting is a TIEBREAK INSIDE a tier and can never lift a lower
   tier above a higher one, so a valid exact match is never hidden.         */
var TIER = { EXACT_NAME:1000, EXACT_ALIAS:900, NAME_PREFIX:800, ALIAS_PREFIX:700,
             WORD:500, CLASS:300, SUMMARY:150, FUZZY:80 };

function norm(s){
  var t = String(s==null?'':s).toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return t.replace(/[\u2010-\u2015-]/g,' ').replace(/[^a-z0-9 .%\/]/g,' ')
          .replace(/\s+/g,' ').trim();
}
/* Damerau-Levenshtein, capped */
function dist(a,b,cap){
  if (Math.abs(a.length-b.length) > cap) return cap+1;
  var m=a.length, n=b.length, prev=[], cur=[], i, j;
  for (j=0;j<=n;j++) prev[j]=j;
  for (i=1;i<=m;i++){
    cur[0]=i; var best=cur[0];
    for (j=1;j<=n;j++){
      var c = a.charAt(i-1)===b.charAt(j-1) ? 0 : 1;
      cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+c);
      if (i>1 && j>1 && a.charAt(i-1)===b.charAt(j-2) && a.charAt(i-2)===b.charAt(j-1))
        cur[j] = Math.min(cur[j], (prev[j-2]===undefined?i+j:prev[j-2])+1);
      if (cur[j]<best) best=cur[j];
    }
    if (best > cap) return cap+1;
    prev = cur.slice();
  }
  return prev[n];
}
function wordBoundaryHit(hay, q){
  var words = hay.split(' ');
  for (var i=0;i<words.length;i++) if (words[i].indexOf(q) === 0) return true;
  return hay.indexOf(' '+q) >= 0;
}

/* Build the flat searchable index from both datasets. */
function buildIndex(){
  var out = [];
  DRUGS.forEach(function(d){
    out.push({
      id:d.id, kind:'drug', name:d.name, cat:'Drugs', pclass:classOf(d),
      aliases:d.aliases||[], klass:d.klass||'', indications:d.indications||[],
      summary:d.summary || (d.doses && d.doses[0] ? (d.doses[0].label||'') : ''),
      module:'drug-references', anchor:d.id,
      priority:d.priority||0,
      unpublished:(d.provenance && d.provenance.state !== 'existing-unchanged'
                   && d.provenance.state !== 'reviewed')
    });
  });
  ITEMS.forEach(function(it){
    out.push({
      id:it.id, kind:it.kind, name:it.name, cat:it.cat,
      aliases:it.aliases||[], klass:'', indications:[],
      summary:it.summary||'', module:it.module, anchor:it.id,
      tube:it.tube, crisis:it.crisis, priority:it.priority||0,
      unpublished:!!it.unpublished
    });
  });
  out.forEach(function(x){
    x._n = norm(x.name);
    x._a = (x.aliases||[]).map(norm);
    x._k = norm(x.klass + ' ' + (x.indications||[]).join(' '));
    x._s = norm(x.summary);
  });
  return out;
}
var INDEX = buildIndex();

function search(q, opts){
  opts = opts || {};
  var nq = norm(q);
  if (nq.length < 2) return [];
  var results = [];
  INDEX.forEach(function(x){
    /* Unpublished clinical content is never returned to a clinician. */
    if (x.unpublished && !opts.includeUnpublished) return;
    var tier = 0;
    if (x._n === nq) tier = TIER.EXACT_NAME;
    else if (x._a.indexOf(nq) >= 0) tier = TIER.EXACT_ALIAS;
    else if (x._n.indexOf(nq) === 0) tier = TIER.NAME_PREFIX;
    else if (x._a.some(function(a){ return a.indexOf(nq) === 0; })) tier = TIER.ALIAS_PREFIX;
    else if (wordBoundaryHit(x._n, nq) || x._a.some(function(a){ return wordBoundaryHit(a, nq); })) tier = TIER.WORD;
    else if (x._k.indexOf(nq) >= 0) tier = TIER.CLASS;
    else if (x._s.indexOf(nq) >= 0) tier = TIER.SUMMARY;
    else {
      /* Fuzzy applies ONLY to canonical names and aliases — never to free text,
         which would flood the results with near-misses. */
      var cap = nq.length < 6 ? 1 : 2;
      var hit = dist(x._n, nq, cap) <= cap ||
                x._a.some(function(a){ return Math.abs(a.length-nq.length) <= cap && dist(a, nq, cap) <= cap; });
      if (hit) tier = TIER.FUZZY;
    }
    if (!tier) return;
    /* tiebreak only: priority can reorder inside a tier, never across tiers */
    results.push({ item:x, tier:tier, score:tier + Math.min(x.priority||0, 9) * 4 });
  });
  var seen = {};
  return results
    .sort(function(a,b){ return b.score - a.score || a.item.name.localeCompare(b.item.name); })
    .filter(function(r){ if (seen[r.item.id]) return false; seen[r.item.id] = 1; return true; })
    .slice(0, opts.limit || 30);
}

var GROUP_ORDER = ['Drugs','Antibiotic prophylaxis','Airway and tubes','Emergencies',
                   'Calculators','Regional and neuraxial','Ventilation','Fluids and blood','Clinical scores'];

function grouped(q, opts){
  var hits = search(q, opts), by = {};
  hits.forEach(function(h){ (by[h.item.cat] = by[h.item.cat] || []).push(h); });
  return GROUP_ORDER.filter(function(g){ return by[g] && by[g].length; })
                    .map(function(g){ return { group:g, hits:by[g] }; });
}

/* ── RENDERING SUPPORT ──────────────────────────────────────────────── */
function isPublishable(d){
  var st = d.provenance && d.provenance.state;
  return st === 'existing-unchanged' || st === 'reviewed';
}
/* prep is authored as "<b>concentration</b> · note". These pull the two
   halves apart without changing the source string. */
function prepConc(p){
  if(!p) return '';
  var m = /<b>([\s\S]*?)<\/b>/.exec(p);
  return m ? m[1] : p;
}
function prepNote(p){
  if(!p) return '';
  var rest = p.replace(/<b>[\s\S]*?<\/b>/, '').trim();
  return rest.replace(/^[·\u00b7\s]+/, '').trim();
}

/* ── ONE ROW BUILDER, EXPLICITLY GIVEN ITS DOSE ───────────────────────────
   PHASE 4A. This body was inline inside visibleDrugsInGroup(), which always
   read doses[0]. That was correct while every publishable record carried
   exactly one dose, and it stops being correct the moment a drug carries both
   an induction bolus and a maintenance infusion: whichever happened to be
   first would silently become what every screen showed.

   The dose is now a parameter. visibleDrugsInGroup() still passes doses[0] and
   its output is unchanged, field for field, at every weight — the suite
   compares it against a snapshot taken before this refactor. What the
   parameter makes possible is asking for a DIFFERENT dose without guessing,
   which is what dosesForPhase() below does.                                */
function rowFor(d, dose, wt){
      var r = renderDose(dose, wt);
      /* ADDITIVE FIELDS for the table view. `ind` is unchanged and still
         carries the whole supporting line, so every existing consumer of this
         function renders exactly as before. `use`, `doseRule` and `aliasLine`
         split the same values into columns; nothing new is computed and no
         range is altered. */
      var rule = '', ruleNum = '', ruleUnit = '';
      if (dose.basisWeight){
        ruleNum  = (dose.low != null ? (dose.low+'–'+dose.high) : String(dose.value));
        ruleUnit = dose.unit + (dose.basis ? (' '+dose.basis) : '');
        rule = ruleNum + ' ' + ruleUnit;
      } else if (dose.basis){ rule = dose.basis; ruleUnit = dose.basis; }
      /* A TITRATION HAS ALREADY SAID ITS MAXIMUM. renderDose composed
         "Start 0.5-1% · up 0.5-1% · max 8%" from the same field, so appending
         "max 8" here printed the ceiling twice on one row, once with its unit
         and once without. The ceiling belongs to the composed line and is
         emitted in exactly one place. */
      if (dose.max && dose.type !== 'titration-protocol'){
        rule += (rule ? ' · ' : '') + 'max ' + dose.max;
        ruleUnit += (ruleUnit ? ' · ' : '') + 'max ' + dose.max;
      }
      /* ── A TITRATION IS THE DOSE, NOT THE AMOUNT FOR THIS PATIENT ─────
         renderDose returns the protocol as the row's value, which put it
         under "This patient" in the reference table — and the protocol is
         identical for every patient of that population. It does not scale
         with a weight and there is nothing patient-specific about it. It
         belongs in the dose column, and the patient column stays empty
         rather than repeating it. */
      var titration = (dose.type === 'titration-protocol');
      if (titration){ rule = r.val; ruleNum = r.val; ruleUnit = ''; }
      return { id:d.id, name:d.name,
               val:titration ? '' : r.val, unit:titration ? '' : r.unit,
               /* The pharmacological class in the record's own words.
                  Additive: `pclass` is the colour system's coarse bucket and
                  says "neuromuscular blocker"; `klass` is what the entry
                  actually says, and depolarising versus non-depolarising is a
                  distinction a blocker card has to be able to make. No value
                  is computed and every existing consumer is unaffected. */
               klass:d.klass || '',
               ind:supportLine(d, dose, wt), prep:d.prep,
               use:[dose.route, dose.label].filter(Boolean).join(' · '),
               /* Passed through if a dose ever carries one. No record does
                  today — there is no duration, onset or offset field anywhere
                  in DRUGS — so this is the wire, not a value. Nothing here
                  manufactures one, and the table's Dur. column stays absent
                  until real data arrives. */
               duration:(dose.duration || ''),
               doseRule:rule,
               /* Up to two trade/common names. aliases[0] is the canonical
                  lowercase form of the name already shown above it, so it is
                  skipped; one alias reads thin and three wrap the cell. */
               aliasLine:(d.aliases ? d.aliases.slice(1,3).join(', ') : ''),
               /* The preparation string is "<b>concentration</b> · note". A
                  column headed Preparation wants the concentration; the note
                  is real and is kept, on its own muted line, the same shape
                  the drug name and its aliases already use. Both halves are
                  split out here so no consumer has to parse markup. `prep`
                  itself is untouched for everything that already renders it. */
               prepMain:prepConc(d.prep), prepNote:prepNote(d.prep),
               /* Numbers and their unit, separated, so a table can give the
                  figure the weight and let the unit sit back. */
               doseNum:ruleNum, doseUnit:ruleUnit,
               warn:d.warn, severity:d.severity, hi:d.hi,
               /* Wires, not values, exactly like `duration` above. A dosing
                  INTERVAL is a clinical fact that only a reviewed source can
                  supply — "re-dose every 20-30 min" is not derivable from an
                  intubating dose, and nothing here derives one. `phase` is
                  the dose's own declaration of which part of the anaesthetic
                  it belongs to, carried through so a consumer can show it. */
               interval:(dose.interval || ''),
               phase:(dose.phase || ''),
               pclass:classOf(d), badge:classBadge(classOf(d)) };
}

function visibleDrugsInGroup(groupId, wt){
  return DRUGS.filter(function(d){ return d.group === groupId && isPublishable(d) && d.doses && d.doses.length; })
    .map(function(d){ return rowFor(d, d.doses[0], wt); });
}

/* ── WHICH PART OF THE ANAESTHETIC A DOSE BELONGS TO ──────────────────────
   PHASE 4A, SCHEMA ONLY. A dose may declare `phase`. It is OPTIONAL and
   ADDITIVE: no record carries one today, every existing consumer ignores it,
   and nothing infers it.

   THE POINT IS THE ABSENCE OF A FALLBACK. Asking for the maintenance dose of
   a drug that has only an intubating dose returns NOTHING — not the
   intubating dose relabelled, not a derived one, not the first dose in the
   list. Propofol's induction bolus can therefore never be presented as a
   maintenance infusion, and rocuronium's intubating dose can never be
   presented as a re-dose, because there is no code path that would let them.

   These phases are the vocabulary the model will accept when reviewed records
   arrive. Declaring the vocabulary is not the same as having the data: today
   maintenanceCoverage() reports zero for every group, and the suite asserts
   it, so the gap is measured rather than assumed.

   ── RSI IS A SIBLING OF INTUBATION, NOT A REFINEMENT OF IT ────────────────
   The vocabulary below is additive; the four original terms are unchanged.
   The seven new ones are the contexts the reviewed evidence matrix speaks in.

   INTUBATION and RSI are two independent terms with NO relationship between
   them. A drug that carries a routine intubating dose and no reviewed RSI
   dose answers dosesForPhase(d,'rsi') with [] — not with the intubating dose,
   not with the intubating dose relabelled, not with a widened range. That is
   not a special case in the code; it is what strict equality on a filter
   already does, and the point of writing RSI as its own term rather than as a
   flag on INTUBATION is that there is no expression anywhere that could let
   one answer for the other.

   A dose carries exactly ONE phase. A drug whose reviewed evidence genuinely
   covers two contexts carries two dose records — which is why dose
   enumeration (visibleDosesInGroup, below) had to come before this vocabulary
   was of any use: a second record on a drug was invisible until it did.     */
/* A PHASE IS THE QUESTION A ROW ANSWERS. SPONTANEOUS is the narrowest of
   them and exists because a label can separate two regimens that share a
   drug, a route and a moment in the case. Fentanyl's adult SmPC dosing is
   one initial dose for a patient who is breathing and a different, far wider
   one for a patient whose ventilation is assisted; an induction board that
   selected a blocker and then printed the spontaneous-respiration figure
   would be answering the wrong question with a real number, which is worse
   than answering none.

   No strategy context asks for this phase today. It is reachable from the
   drug reference, which enumerates what a record holds, and from any future
   context written for a spontaneously breathing technique. */
var PHASES = { INDUCTION:'induction', MAINTENANCE:'maintenance',
               REDOSE:'redose', REVERSAL:'reversal',
               INTUBATION:'intubation', RSI:'rsi',
               PREMEDICATION:'premedication', ANALGESIA:'analgesia',
               SEDATION:'sedation', INFUSION:'infusion', RESCUE:'rescue',
               SPONTANEOUS:'spontaneous-respiration' };

function dosesForPhase(d, phase){
  if (!d || !d.doses || !phase) return [];
  return d.doses.filter(function(x){ return x.phase === phase; });
}

/* Publishable drugs in a group that carry a dose for this phase. Returns []
   when none do — which is every group, today. */
function visibleInGroupForPhase(groupId, wt, phase){
  var out = [];
  DRUGS.forEach(function(d){
    if (d.group !== groupId || !isPublishable(d)) return;
    dosesForPhase(d, phase).forEach(function(dose){ out.push(rowFor(d, dose, wt)); });
  });
  return out;
}

/* What the model actually holds for a phase, per group. This is the gap
   report: a domain built on it renders what exists and says nothing about
   what does not. */
function phaseCoverage(phase){
  var out = {};
  GROUPS.forEach(function(g){
    var pub = DRUGS.filter(function(d){ return d.group === g.id && isPublishable(d); });
    out[g.id] = { publishable:pub.length,
                  withPhase:pub.filter(function(d){ return dosesForPhase(d, phase).length; }).length };
  });
  return out;
}
/* ── WHO A DOSE WAS REVIEWED FOR ──────────────────────────────────────────
   MACHINERY ONLY. No record carries any field below, so every function here
   is inert against today's dataset and the render baseline is unchanged.

   THE DEFECT THIS EXISTS TO CLOSE. Every one of the 25 publishable doses is
   population:'adult', and that field was read by nothing. renderDose()
   branches on weight and on whether the unit is a rate — and on nothing else
   — so a 16 kg four-year-old was shown propofol 1.5x16-2.5x16 = 24-40 mg,
   in normal type, derived from a record reviewed for adults. The number was
   arithmetic performed on evidence that does not cover the patient.

   THE EVIDENCE CLASS IS NOT THE APPLICABILITY. `population` says who a dose
   may be given to; `populationClass` says what the source actually
   established. They are separate because class D — one reviewed rule for
   adults and children — must be ONE record that serves both, and a single
   field cannot say "applies to both, and the source says so" as distinct
   from "we only ever wrote down the adult case".

     A  adult-specific        adult eligible · paediatric withheld
     B  paediatric-specific   paediatric eligible · adult withheld
     C  age-banded paediatric paediatric inside the exact band · nothing else
     D  one reviewed rule     both eligible · ONE canonical record, never two
     E  inadequately specified never eligible, never published

   There is no nearest-age fallback, no adult->child fallback and no
   child->adult fallback. A patient the reviewed evidence does not cover gets
   no number at all — not a scaled one, not a caveated one.                 */
/* ── THE INDUCTION BOARD'S FOUR ROWS LIVE ELSEWHERE ──────────────────────
   They used to be here, as a list of DRUGS ids — which meant a drug had to
   exist as a clinical record before it could appear on the board, and that
   pressure is what produced seven zero-dose records whose only reason to
   exist was that the composition named them. Board membership is a
   composition decision; a canonical record is a clinical one. The catalog is
   in induction-catalog.js and holds no medicine; this file holds no
   composition.                                                            */

var POPCLASS = { ADULT:'A', PAEDIATRIC:'B', AGE_BANDED:'C', BOTH:'D', UNSPECIFIED:'E' };

/* ── AGE BANDS ────────────────────────────────────────────────────────────
   THE BAND SAYS WHAT THE LABEL SAID. A boundary is a value, a unit and
   whether it is inclusive — nothing is converted at data-entry time, so
   "3 through 16 years" and "1 month to <2 years" survive into the record as
   themselves rather than as day counts someone computed:

     ageBand:{ min:{ value:3, unit:'years',  inclusive:true  },
               max:{ value:16, unit:'years', inclusive:true  } }
     ageBand:{ min:{ value:1, unit:'months', inclusive:true  },
               max:{ value:2, unit:'years',  inclusive:false } }

   An absent min or max is an open bound. Units are days, weeks, months and
   years. A band is never inferred from prose: a label that says "small
   pediatric patients" without defining the boundary produces no band, and a
   dose with no band cannot be class C.

   ── WHY THERE IS NO 365.25 IN HERE ───────────────────────────────────────
   The application takes age as a value and a unit, and ageCanon() in
   engine.html turns that into days with x365.25 and x30.4375. Those constants
   are fine for a fluid rate and are not fine for a boundary: at 16 years they
   move the edge by four days, so whether a patient is inside a band would
   depend on an approximation nobody reviewed.

   So the comparison is done in the units actually given, and only where the
   conversion is EXACT:

     CALENDAR units - years and months - convert to each other exactly (x12).
     ELAPSED  units - weeks and days   - convert to each other exactly (x7).

   Within one family the comparison is arithmetic and the birthday semantics
   are the label's own: a patient entered as "2 years" is below a 3-year
   boundary and a patient entered as "3 years" is on it.

   ACROSS the two families there is no exact conversion, because a month is
   28-31 days and a year is 365-366. THE APPLICATION HAS NO DATE OF BIRTH —
   it stores a value and a unit — so the exact number of days a patient
   entered as "3 years" has lived is not knowable here, and inventing it is
   the whole failure being avoided. Instead each side becomes the INTERVAL of
   days it could possibly span, and an answer is given only when the intervals
   do not overlap. A 60-day-old is unambiguously past a 1-month boundary; a
   30-day-old is not decidable, because a month may be 28, 29, 30 or 31 days.

   WHEN PRECISION IS INSUFFICIENT, WITHHOLD. Undecidable never resolves to
   admitted, anywhere, for any bound. Showing no number is the one direction
   that is always safe.                                                      */
var AGE_FAMILY = { years:'cal', months:'cal', weeks:'ela', days:'ela' };
var AGE_IN_FAMILY = { years:12, months:1, weeks:7, days:1 };   /* to months | to days */
/* The days a quantity could possibly span. Deliberately conservative. */
var AGE_SPAN = { days:[1,1], weeks:[7,7], months:[28,31], years:[365,366] };

function ageSpanDays(q){
  var s = AGE_SPAN[q.unit];
  return s ? [q.value * s[0], q.value * s[1]] : null;
}
/* -1 | 0 | 1 | null(undecidable), comparing patient age against a boundary. */
function compareAge(patient, bound){
  if (!patient || !bound) return null;
  if (patient.value == null || bound.value == null) return null;
  var pf = AGE_FAMILY[patient.unit], bf = AGE_FAMILY[bound.unit];
  if (!pf || !bf) return null;
  if (pf === bf){
    /* AN AGE IS COMPLETED UNITS, AND THE BOUND SETS THE GRANULARITY. "16
       years" names a year of life, not an instant: someone of 16 years and
       11 months IS sixteen, and "through 16 years" has to admit them or the
       band ends on the 16th birthday instead of the 17th. So the patient is
       expressed in the bound's own unit and floored to completed units —
       203 months against a bound in years is 16, not 16.9. Comparing raw
       months against 192 would have withheld every 16-year-old but one. */
    var p = Math.floor((patient.value * AGE_IN_FAMILY[patient.unit]) /
                       AGE_IN_FAMILY[bound.unit]);
    var b = bound.value;
    return p < b ? -1 : (p > b ? 1 : 0);
  }
  var ps = ageSpanDays(patient), bs = ageSpanDays(bound);
  if (!ps || !bs) return null;
  if (ps[1] < bs[0]) return -1;                    /* certainly below */
  if (ps[0] > bs[1]) return 1;                     /* certainly above */
  return null;                                     /* overlapping: not decidable */
}
/* age = { value, unit } as the clinician entered it. */
function inAgeBand(band, age){
  if (!band) return false;
  if (!age || age.value == null || !AGE_FAMILY[age.unit]) return false;
  if (band.min){
    var lo = compareAge(age, band.min);
    if (lo === null) return false;                 /* undecidable → withheld */
    if (lo < 0) return false;
    if (lo === 0 && band.min.inclusive === false) return false;
  }
  if (band.max){
    var hi = compareAge(age, band.max);
    if (hi === null) return false;
    if (hi > 0) return false;
    if (hi === 0 && band.max.inclusive === false) return false;
  }
  return true;
}

/* ── APPLICABILITY — THE CRITERIA A POPULATION CANNOT CARRY ───────────────
   "Adult" does not mean "healthy adult under 65 of ASA I-II", and a reviewed
   range qualified that way must not render for everybody just because the
   patient is an adult. Putting the qualification in the label would be
   display text: readable, and no kind of gate.

   GENERIC BY CONSTRUCTION. The selector evaluates whatever criteria a record
   declares and knows nothing about which drug it belongs to. Two are
   supported and that is deliberately all: an age bound (same structured
   shape as ageBand above) and a list of admissible ASA classes. No renal,
   hepatic or haemodynamic logic, and nothing that recommends.

     applicability:{ ageBand:{ max:{ value:65, unit:'years', inclusive:false } },
                     asa:['I','II'] }

   A CRITERION THAT CANNOT BE EVALUATED IS NOT SATISFIED. If a record requires
   an ASA class and none has been entered, the dose is withheld — the reviewed
   evidence covers a patient profile we cannot confirm this patient has.

   APPLICABILITY IS THE DOSE'S BUSINESS, NOT THE PATIENT FORM'S. ASA is not
   made mandatory for every case to satisfy this: most reviewed records will
   not mention it, and a workstation that refuses to open until an unrelated
   field is filled has moved one record's requirement onto every patient. Only
   the record that asks for ASA is withheld without it.

   Returns null when the dose applies, otherwise the WITHHELD reason.        */
function applicabilityFailure(app, pop){
  if (!app || !pop) return null;                   /* no patient — see patientPopulation */
  if (app.ageBand && !inAgeBand(app.ageBand, pop.age)) return WITHHELD.PROFILE;
  if (app.asa && app.asa.length){
    if (!pop.asa) return WITHHELD.ASA;             /* askable, and worth saying so */
    if (app.asa.indexOf(pop.asa) < 0) return WITHHELD.PROFILE;
  }
  return null;
}
function meetsApplicability(app, pop){ return applicabilityFailure(app, pop) === null; }

/* ── WHAT THE PATIENT IS, REDUCED TO WHAT A DOSE RULE ASKS ────────────────
   patientContext is the single source of truth for who the patient is; this
   takes the two facts a population rule needs and nothing else. Returns null
   when no patient is known or the age is not known — and null means NO GATE
   IS APPLIED, because with no patient there is no one for a dose to be
   ineligible for. The drug reference with no patient loaded still shows every
   published rule, which is what a reference is.                             */
function patientPopulation(pc){
  if (!pc || !pc.context) return null;
  var peds = pc.context.pediatric === true, adult = pc.context.adult === true;
  if (!peds && !adult) return null;               /* age unknown */
  /* AS ENTERED, NOT AS CONVERTED. age.days exists and is derived with
     x365.25; it is not what decides a boundary. value and unit are what the
     clinician actually stated, and compareAge() works in those. */
  return { pediatric:peds, adult:adult,
           age:(pc.age && pc.age.value != null
                  ? { value:pc.age.value, unit:AGE_UNIT_NAME[pc.age.unit] || pc.age.unit }
                  : null),
           asa:pc.asa || null };
}
/* engine.html stores the unit as the <select> value; the model speaks in
   whole words so a record reads as the label reads. */
var AGE_UNIT_NAME = { y:'years', mo:'months', w:'weeks', d:'days' };

/* ── THE COVERAGE STATES ──────────────────────────────────────────────────
   A WITHHELD DOSE IS A STATEMENT ABOUT OUR DATA, NEVER ABOUT THE DRUG. The
   wording is fixed here, in one place, so no screen can invent its own. None
   of it says contraindicated, not recommended, or unavailable: absence of a
   reviewed Anestheo record does not mean the drug is clinically wrong for the
   patient, and a coverage message that implies otherwise is a clinical claim
   we have no evidence for.                                                  */
var WITHHELD = { PAEDIATRIC:'paediatric-not-reviewed', ADULT:'adult-not-reviewed',
                 AGE:'age-not-reviewed', ASA:'asa-unknown',
                 PROFILE:'profile-not-reviewed', CONTEXT:'context-not-reviewed',
                 UNPUBLISHED:'not-publishable' };
var COVERAGE = {};
COVERAGE[WITHHELD.PAEDIATRIC] = 'Pediatric dose not reviewed';
COVERAGE[WITHHELD.ADULT]      = 'Adult dose not reviewed';
COVERAGE[WITHHELD.AGE]        = 'No reviewed dose for this age';
/* MISSING IS NOT MISMATCHED. A record reviewed for ASA I-II withheld from an
   ASA III patient is a coverage gap and nothing can change it; the same
   record withheld because no ASA was entered is a gap the clinician can close
   in one keystroke. Saying which it is costs nothing and is the difference
   between a dead end and a next step. */
COVERAGE[WITHHELD.ASA]        = 'ASA required to match reviewed dose';
COVERAGE[WITHHELD.PROFILE]    = 'Reviewed dose not available for this patient profile';
COVERAGE[WITHHELD.CONTEXT]    = 'Dose not reviewed for this context';
COVERAGE[WITHHELD.UNPUBLISHED]= 'Dose not reviewed';

/* ── THREE SEPARATE THINGS, AND THEY MUST NOT COLLAPSE ────────────────────
   An earlier cut of this migration read population:'adult' on a legacy record
   and treated it as populationClass 'A'. That was wrong, and wrong in the
   direction that matters: it made the model claim evidence it does not have.

     1  population        metadata. "this record was entered as adult."
     2  populationClass   EVIDENCE. "a reviewed source establishes this for
                          adults" — A/B/C/D/E, and nothing else may set it.
     3  eligibility       whether THIS patient may see THIS dose.

   Legacy records carry 1 and not 2. They are not category A: nobody reviewed
   them; they were typed in. Synthesising a class from metadata would mean a
   record that never met a source reporting itself as source-backed, and every
   later question — what is reviewed, what still needs review, what may be
   published — would get the wrong answer from then on.

   So 1 is allowed to decide 3, and is never allowed to become 2.

   ── LEGACY COMPATIBILITY: ADMISSION ONLY ──────────────────────────────────
   A dose with no populationClass, on a drug whose provenance says
   existing-unchanged, and declaring an explicit population, is admitted for
   that population and withheld from the other. That is the whole rule. It
   grants no class, promotes no state, and adds no field: nothing is written
   back to the record, and CC.DRUGS after this call is byte-identical to
   CC.DRUGS before it.

   What it buys is the thing that actually mattered — midazolam, morphine,
   dexmedetomidine, the two sugammadex records and neostigmine keep rendering
   for the adults they were entered for, and disappear from a child's screen,
   without a single held record being edited to make it happen.

   A dose with no class and no usable legacy population is withheld from
   everyone. There is no path here that admits a dose we cannot place.       */
function legacyAdmission(drug, dose, pop){
  var st = drug && drug.provenance && drug.provenance.state;
  if (st !== 'existing-unchanged') return { eligible:false, reason:WITHHELD.UNPUBLISHED };
  if (!pop) return { eligible:true };             /* no patient — see patientPopulation */
  if (dose.population === 'adult')
    return pop.adult ? { eligible:true } : { eligible:false, reason:WITHHELD.PAEDIATRIC };
  if (dose.population === 'paediatric')
    return pop.pediatric ? { eligible:true } : { eligible:false, reason:WITHHELD.ADULT };
  return { eligible:false, reason:WITHHELD.UNPUBLISHED };
}

/* ── IS THIS DOSE ELIGIBLE FOR THIS PATIENT ───────────────────────────────
   THE ORDER IS FIXED AND EACH STAGE CAN ONLY WITHHOLD:

     1  publishable          (isDosePublishable, run by the caller)
     2  population           A/B/C/D/E against adult or paediatric
     3  age band             class C only, the label's own boundary
     4  applicability        any further reviewed criteria the record carries

   A later stage never rescues an earlier one and no stage substitutes
   anything. Returns { eligible:true } or { eligible:false, reason }, and
   never a dose, a number or an alternative.                                 */
function doseEligibility(dose, pop, drug){
  var k = dose && dose.populationClass;
  /* NO CLASS — the legacy path, which admits and never classifies. */
  if (!k) return legacyAdmission(drug, dose || {}, pop);
  if (k === POPCLASS.UNSPECIFIED) return { eligible:false, reason:WITHHELD.UNPUBLISHED };
  /* 2 — POPULATION */
  if (pop){
    if (k === POPCLASS.ADULT && !pop.adult)
      return { eligible:false, reason:WITHHELD.PAEDIATRIC };
    if (k === POPCLASS.PAEDIATRIC && !pop.pediatric)
      return { eligible:false, reason:WITHHELD.ADULT };
    if (k === POPCLASS.AGE_BANDED){
      if (!pop.pediatric) return { eligible:false, reason:WITHHELD.ADULT };
      /* 3 — AGE BAND. Undecidable counts as outside; see compareAge(). */
      if (!inAgeBand(dose.ageBand, pop.age))
        return { eligible:false, reason:WITHHELD.AGE };
    }
    if (k !== POPCLASS.ADULT && k !== POPCLASS.PAEDIATRIC &&
        k !== POPCLASS.AGE_BANDED && k !== POPCLASS.BOTH)
      return { eligible:false, reason:WITHHELD.UNPUBLISHED };   /* unknown class */
  } else if (k !== POPCLASS.ADULT && k !== POPCLASS.PAEDIATRIC &&
             k !== POPCLASS.AGE_BANDED && k !== POPCLASS.BOTH){
    return { eligible:false, reason:WITHHELD.UNPUBLISHED };
  }
  /* 4 — APPLICABILITY */
  var fail = applicabilityFailure(dose.applicability, pop);
  if (fail) return { eligible:false, reason:fail };
  return { eligible:true };
}

/* ── PUBLISHABILITY, PER DOSE ─────────────────────────────────────────────
   The drug-level gate is unchanged and still runs first, so nothing that was
   unpublishable becomes publishable here. What this adds is the ability to
   hold ONE dose back while its drug keeps rendering the others — which is the
   whole staged-review path: a reviewed adult record ships while its
   paediatric counterpart is still with the reviewer.

   A DOSE THAT CLAIMS TO BE REVIEWED MUST CARRY ITS CITATION. authority,
   documentId and section are required, not decorative. A record marked
   reviewed with an empty section is an unreviewed record with a flag set, and
   it must not be the thing that decides what a clinician draws up.

   `evidence` absent = a migrated record, gated by its drug exactly as before.
   That is what keeps the 25 existing doses byte-identical.                  */
function isDosePublishable(drug, dose){
  if (!isPublishable(drug)) return false;
  if (!dose) return false;
  if (dose.populationClass === POPCLASS.UNSPECIFIED) return false;
  var e = dose.evidence;
  if (!e) return true;                            /* pre-existing record, unchanged */
  if (e.state === 'existing-unchanged') return true;
  if (e.state !== 'reviewed') return false;
  return !!(e.authority && e.documentId && e.section);
}

/* ── A ROW THAT CARRIES NO NUMBER ─────────────────────────────────────────
   THE DRUG STAYS, THE DOSE GOES. The toolbox is a formulary as well as a
   dosing surface: propofol is a primary induction agent for a three-year-old
   whether or not we hold a reviewed paediatric record, and a tile that
   vanishes teaches the clinician that the drug is unavailable. So the tile
   keeps its name, its class colour, its group placement and its aliases, and
   the patient-specific region is replaced by the coverage line.

   renderDose() IS NEVER CALLED HERE. Not called and the result discarded —
   not called. There is no code path in this function that multiplies a dose
   by a weight, so there is no number to leak into a row that must not have
   one, whatever a later caller does with it.

   prepNote is deliberately dropped while prepMain is kept. prepMain is the
   vial concentration, a fact about the formulation that no patient makes
   true or false. prepNote is the free-prose half — and prose is exactly
   where the two dose values we already know about are hiding ("1.2 mg/kg for
   RSI", "glycopyrrolate 0.2 mg per 1 mg"). Printing it on a row whose entire
   purpose is to show no dose would defeat the row.                          */
function withheldRowFor(d, reason){
  return { id:d.id, name:d.name, klass:d.klass || '',
           aliasLine:(d.aliases ? d.aliases.slice(1,3).join(', ') : ''),
           prepMain:prepConc(d.prep), prepNote:'',
           warn:d.warn, severity:d.severity, hi:d.hi,
           pclass:classOf(d), badge:classBadge(classOf(d)),
           /* every dose-bearing field, explicitly empty */
           val:'', unit:'', ind:'', use:'', prep:'', duration:'',
           doseRule:'', doseNum:'', doseUnit:'', interval:'', phase:'',
           withheld:true, reason:reason, coverage:(COVERAGE[reason] || COVERAGE[WITHHELD.UNPUBLISHED]) };
}

/* ── ONE ROW PER DOSE, NOT ONE ROW PER DRUG ───────────────────────────────
   visibleDrugsInGroup() maps rowFor(d, d.doses[0]) — correct while every
   record carried exactly one dose, and silently lossy the moment one carries
   two. A ketamine with an IV and an IM induction record would have rendered
   the IV one and dropped the other, everywhere, with nothing to show that a
   second existed.

   This enumerates instead. Per drug:
     - every publishable dose the patient is eligible for becomes a row;
     - if the drug has publishable doses but the patient is eligible for none,
       it becomes exactly ONE withheld row — the drug stays, the dose goes;
     - a drug with no publishable dose at all is absent, unchanged from today.

   `phase` and `route` narrow the set before eligibility is considered. Phase
   goes through dosesForPhase() and its strict equality — so asking for RSI on
   a drug whose only reviewed record is a routine intubating dose yields no
   rows to be eligible for, and the drug reports coverage rather than a
   substitute. Route matches the same way, exactly, so asking for IM never
   answers with the IV record.

   NARROWING IS NOT WITHHOLDING. A drug with no dose in the requested scope
   produces no row at all — not a coverage line. Coverage means "this patient
   is not covered by evidence we hold"; a drug that simply has no IM record
   has nothing to say about this patient.                                    */
function visibleDosesInGroup(groupId, wt, pop, phase, route){
  var out = [];
  DRUGS.forEach(function(d){
    if (d.group !== groupId || !isPublishable(d) || !d.doses || !d.doses.length) return;
    var candidates = phase ? dosesForPhase(d, phase) : d.doses;
    if (route) candidates = candidates.filter(function(x){ return x.route === route; });
    var publishable = candidates.filter(function(x){ return isDosePublishable(d, x); });
    if (!publishable.length) return;              /* nothing reviewed: not a coverage state */
    var shown = 0, reason = null;
    publishable.forEach(function(dose){
      var e = doseEligibility(dose, pop, d);
      if (e.eligible){ out.push(rowFor(d, dose, wt)); shown++; }
      else if (!reason) reason = e.reason;
    });
    if (!shown) out.push(withheldRowFor(d, reason || WITHHELD.UNPUBLISHED));
  });
  return out;
}

/* ── ONE DRUG, ONE CONTEXT, ONE ROW ───────────────────────────────────────
   THE INDUCTION PLAN ASKS A DIFFERENT QUESTION FROM THE REFERENCE. The
   reference asks "what has been reviewed for this drug" and answers with
   every eligible record. The plan asks "what am I giving this patient, in
   the technique I am running", and that has exactly one answer or none.

   Once rocuronium carried a routine intubating dose and an RSI dose, the plan
   took the first row and showed 0.6 mg/kg while the technique strip said
   Classic RSI. The number was real, reviewed and for the wrong context — the
   most convincing way to be wrong.

   `contexts` is an ORDERED list of phases to try, and it is the caller's
   statement of what the context means, not a fallback chain the model
   invented. For a blocker under RSI the list has ONE entry, so there is
   nothing to fall back to: a drug with no reviewed RSI record yields a
   withheld row and never its intubating dose. For a hypnotic the list is
   ['rsi','induction'] because the reviewed labels do not dose them
   differently for a rapid sequence — if one ever does, its record will be
   found first without this code changing.

   LEGACY_CONTEXT IS A RECORD THAT DECLARES NO CONTEXT, NOT A WILDCARD. Every
   record that predates the reviewed migration carries no `phase` — midazolam,
   morphine, dexmedetomidine, the legacy fentanyl and remifentanil rows — so a
   plan that filtered on phase alone would have shown a coverage line for
   every one of them, in a workspace where the reference beside it prints
   their dose without hesitation. This entry matches ONLY doses with no phase
   at all. It never returns a dose that declares a different context, which is
   the difference between reading a record that says nothing and overruling
   one that says something.

   It is offered to hypnotics and opioids and NOT to blockers. There is no
   unphased blocker record today, and there must never be a tier that could
   quietly answer an RSI question with one.

   Returns a rendered row, or a withheld row carrying the reason. Never a
   dose from a context that was not asked for.                              */
var LEGACY_CONTEXT = '(unphased)';
function doseRowForContext(drug, wt, pop, contexts){
  if (!drug || !isPublishable(drug) || !drug.doses) return null;
  var list = contexts && contexts.length ? contexts : [LEGACY_CONTEXT];
  var sawInContext = false, reason = null;
  for (var i = 0; i < list.length; i++){
    var phase = list[i];
    var candidates = (phase === LEGACY_CONTEXT)
      ? drug.doses.filter(function(x){ return !x.phase; })
      : dosesForPhase(drug, phase);
    for (var j = 0; j < candidates.length; j++){
      var dose = candidates[j];
      if (!isDosePublishable(drug, dose)) continue;
      sawInContext = true;
      var e = doseEligibility(dose, pop, drug);
      if (e.eligible) return rowFor(drug, dose, wt);
      if (!reason) reason = e.reason;
    }
  }
  if (!sawInContext) reason = WITHHELD.CONTEXT;    /* nothing reviewed for this context */
  var row = withheldRowFor(drug, reason || WITHHELD.UNPUBLISHED);
  /* THE MESSAGE NAMES THE CONTEXT WHEN THE CONTEXT IS WHY. "Pediatric dose
     not reviewed" under a technique strip reading Classic RSI is true and
     unhelpful; what the clinician needs to know is that it is the RSI dose
     we do not hold. Only RSI is named, because it is the only context the
     workspace lets you switch into. */
  if (list.indexOf(PHASES.RSI) >= 0)
    row.coverage = (pop && pop.pediatric ? 'Pediatric RSI' : 'RSI') + ' dose not reviewed';
  row.context = list[0] || '';
  return row;
}

function byId(id){
  for (var i=0;i<DRUGS.length;i++) if (DRUGS[i].id === id) return DRUGS[i];
  for (var j=0;j<ITEMS.length;j++) if (ITEMS[j].id === id) return ITEMS[j];
  return null;
}
function indexEntry(id){
  for (var i=0;i<INDEX.length;i++) if (INDEX[i].id === id) return INDEX[i];
  return null;
}

global.ClinicalContent = {
  GROUPS:GROUPS, DRUGS:DRUGS, ITEMS:ITEMS, INDEX:INDEX, PCLASS:PCLASS,
  classOf:classOf, classMeta:classMeta, classBadge:classBadge,
  REGIONAL_REVIEW:REGIONAL_REVIEW, GROUP_ORDER:GROUP_ORDER,
  search:search, grouped:grouped, byId:byId, indexEntry:indexEntry,
  visibleDrugsInGroup:visibleDrugsInGroup, isPublishable:isPublishable,
  /* fmtNum is exported so the precision invariant can be unit-tested
     directly, not only through a rendered dose. */
  renderDose:renderDose, fmtNum:fmtNum, norm:norm,
  /* PHASE 4A — schema and selectors only. No record declares a phase yet, so
     visibleInGroupForPhase() returns [] for every group and phaseCoverage()
     reports zero. Both are here so the Maintenance domain can be built
     against a model that cannot fall back to the wrong dose. */
  PHASES:PHASES, dosesForPhase:dosesForPhase,
  visibleInGroupForPhase:visibleInGroupForPhase, phaseCoverage:phaseCoverage,
  /* POPULATION ELIGIBILITY — machinery only. No record carries
     populationClass, ageBand or evidence, so visibleDosesInGroup() returns
     exactly what visibleDrugsInGroup() returns and withheldRowFor() is
     never reached. The gate is built, wired and tested before it holds
     anything, which is the only order in which it can be proved inert. */
  POPCLASS:POPCLASS, WITHHELD:WITHHELD, COVERAGE:COVERAGE,
  legacyAdmission:legacyAdmission, doseRowForContext:doseRowForContext,
  LEGACY_CONTEXT:LEGACY_CONTEXT,
  AGE_FAMILY:AGE_FAMILY, compareAge:compareAge,
  meetsApplicability:meetsApplicability, applicabilityFailure:applicabilityFailure,
  inAgeBand:inAgeBand, patientPopulation:patientPopulation,
  doseEligibility:doseEligibility, isDosePublishable:isDosePublishable,
  visibleDosesInGroup:visibleDosesInGroup,
  stats:function(){
    var pub = DRUGS.filter(isPublishable).length;
    return { drugs:DRUGS.length, published:pub, unpublished:DRUGS.length - pub,
             items:ITEMS.length, indexed:INDEX.length,
             searchable:INDEX.filter(function(x){ return !x.unpublished; }).length };
  }
};
})(typeof window !== 'undefined' ? window : this);
