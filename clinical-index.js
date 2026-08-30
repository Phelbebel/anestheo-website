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
/* `decimals` is carried per dose so migrated values print exactly as the
   previous build printed them. Defaulting would silently change three of
   them (midazolam, morphine, neostigmine). */
function fmtNum(n, dec){ if (dec === 1) return r1(n); return (Math.abs(n) < 1 ? r1(n) : r0(n)); }

/* Render one structured dose for a given patient weight (kg | null). */
function renderDose(d, wt){
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
   Hues follow the ISO 26825 anaesthesia syringe-label convention so the colour
   on screen matches the colour on the syringe. Values are screen-tuned: every
   one clears WCAG AA (>=4.5:1) against the dark pane ground.

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
  anticholinergic:{ label:'Anticholinergic', color:'#4FE39B', short:'ANTICHOLINERGIC' },
  local:        { label:'Local anaesthetic', color:'#C3D2CD', short:'LOCAL' },
  uterotonic:   { label:'Uterotonic',     color:'#FFFFFF', short:'UTEROTONIC' },
  reversal:     { label:'Reversal agent', color:'#5FE0A4', short:'REVERSAL', zebra:true }
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
  doses:[{ label:'Induction', route:'IV', low:1.5, high:2.5, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
  prep:'<b>1% = 10 mg/mL</b>',
  warn:'Reduce 30–50% in the elderly, hypovolaemia and ASA III–IV.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Induction · 1.5–2.5 mg/kg TBW' } },

{ id:'drug.ketamine', name:'Ketamine', group:'induction',
  pclass:'induction',
  aliases:['ketamine','ketalar','esketamine','special k'],
  klass:'NMDA antagonist',
  indications:['induction','haemodynamic instability','analgesia'],
  doses:[{ label:'Induction', route:'IV', low:1, high:2, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
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
  doses:[{ label:'Intubation', route:'IV', low:0.6, high:1.2, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
  prep:'<b>10 mg/mL</b> · 1.2 mg/kg for RSI',
  warn:'Only after confirming you can ventilate — unless sugammadex is drawn up.',
  severity:'critical',
  provenance:{ state:'existing-unchanged', verbatim:'Intubation · 0.6–1.2 mg/kg TBW' } },

{ id:'drug.suxamethonium', name:'Suxamethonium', group:'nmb',
  pclass:'nmb',
  aliases:['suxamethonium','succinylcholine','sux','scoline','anectine','celocurine','suxamethonium chloride'],
  klass:'Depolarising neuromuscular blocker',
  indications:['rapid sequence induction','laryngospasm'],
  doses:[{ label:'RSI', route:'IV', low:1, high:1.5, unit:'mg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
  prep:'<b>50 mg/mL</b>',
  warn:'Contraindicated in hyperkalaemia, burns &gt;24 h, denervation, MH susceptibility.',
  severity:'critical', hi:true,
  provenance:{ state:'existing-unchanged', verbatim:'RSI · 1–1.5 mg/kg TBW' } },

{ id:'drug.fentanyl', name:'Fentanyl', group:'analgesia',
  pclass:'opioid',
  aliases:['fentanyl','fentanil','sublimaze'],
  klass:'Synthetic opioid',
  indications:['analgesia','obtunding laryngoscopy response'],
  doses:[{ label:'Peri-induction analgesia', route:'IV', low:1, high:3, unit:'mcg/kg', basis:'TBW', basisWeight:true, population:'adult', type:'range' }],
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
  doses:[{ label:'Infusion', route:'IV', low:0.05, high:0.2, unit:'mcg/kg/min', population:'adult', type:'range' }],
  prep:'<b>50 mcg/mL</b> (2 mg / 40 mL)',
  warn:'No residual analgesia — establish multimodal cover before stopping.',
  severity:'caution',
  provenance:{ state:'existing-unchanged', verbatim:'Infusion · 0.05–0.2 mcg/kg/min' } },

{ id:'drug.dexmedetomidine', name:'Dexmedetomidine', group:'induction',
  pclass:'induction',
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
  indications:['opioid-sparing analgesia','airway reactivity','ventricular arrhythmia'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'National formulary + institutional IV lidocaine protocol',
               sourceAccessed:false } },

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
  aliases:['ondansetron','zofran','ondanse','setron'],
  klass:'5-HT3 receptor antagonist',
  indications:['postoperative nausea and vomiting','PONV prophylaxis'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'Consensus PONV guideline + SmPC', sourceAccessed:false } },

{ id:'drug.sevoflurane', name:'Sevoflurane', group:'volatile',
  aliases:['sevoflurane','sevo','sevorane','ultane'],
  klass:'Halogenated volatile anaesthetic',
  indications:['inhalational induction','maintenance of anaesthesia'],
  doses:[], prep:'', severity:'caution',
  provenance:{ state:'proposed-unverified', reviewer:'internal_clinical',
               candidateSource:'SmPC + MAC reference tables', sourceAccessed:false } }
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

function visibleDrugsInGroup(groupId, wt){
  return DRUGS.filter(function(d){ return d.group === groupId && isPublishable(d) && d.doses && d.doses.length; })
    .map(function(d){
      var dose = d.doses[0];
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
      if (dose.max){
        rule += (rule ? ' · ' : '') + 'max ' + dose.max;
        ruleUnit += (ruleUnit ? ' · ' : '') + 'max ' + dose.max;
      }
      return { id:d.id, name:d.name, val:r.val, unit:r.unit,
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
               pclass:classOf(d), badge:classBadge(classOf(d)) };
    });
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
  renderDose:renderDose, norm:norm,
  stats:function(){
    var pub = DRUGS.filter(isPublishable).length;
    return { drugs:DRUGS.length, published:pub, unpublished:DRUGS.length - pub,
             items:ITEMS.length, indexed:INDEX.length,
             searchable:INDEX.filter(function(x){ return !x.unpublished; }).length };
  }
};
})(typeof window !== 'undefined' ? window : this);
