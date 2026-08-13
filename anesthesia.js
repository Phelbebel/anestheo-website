/* anesthesia.js — the data layer and clinical vocabulary for the Live Chart.
   Load order: CDN → supabase.js → auth.js → anesthesia.js → page script.

   Every write goes through here so there is one place that decides what a
   "medication administration" looks like, and one place to change when the
   schema grows. Nothing in this file is a security boundary: RLS decides who
   may read or write a case. What this file does is keep the client honest —
   it never sends entered_by for someone else, never invents a timestamp it
   did not observe, and never computes a dose.

   The chart has roughly twenty tables and several hundred fields. They are
   DESCRIBED here rather than hand-written as markup, because four hundred
   hand-built inputs drift: one forgets its label, one is too small to tap, one
   silently stops saving. A described field is rendered by one renderer, so a
   fix reaches every field at once and a new field is one line.

   What this file will not do: recommend a dose, interpret a lab, decide that a
   patient is adequately fasted, or claim a monitor produced a number a person
   typed. Those are clinical judgements and they belong to the clinician. */
(function(){
'use strict';

var ANES = {};

/* ═══════════ REFERENCE DATA ═══════════════════════════════════════════════
   Favourites are the doses a clinician actually reaches for, so one tap
   records the common case. They are a starting point, never a prescription:
   the custom form is always there and every entry stays editable. */
ANES.FAVOURITES = [
  { name:'Fentanyl',      dose:50,  unit:'mcg', cat:'opioid' },
  { name:'Fentanyl',      dose:100, unit:'mcg', cat:'opioid' },
  { name:'Propofol',      dose:100, unit:'mg',  cat:'induction' },
  { name:'Rocuronium',    dose:50,  unit:'mg',  cat:'nmb' },
  { name:'Suxamethonium', dose:100, unit:'mg',  cat:'nmb' },
  { name:'Midazolam',     dose:2,   unit:'mg',  cat:'sedative' },
  { name:'Phenylephrine', dose:100, unit:'mcg', cat:'vasopressor' },
  { name:'Ephedrine',     dose:5,   unit:'mg',  cat:'vasopressor' },
  { name:'Ondansetron',   dose:4,   unit:'mg',  cat:'antiemetic' },
  { name:'Dexamethasone', dose:4,   unit:'mg',  cat:'steroid' },
  { name:'Cefazolin',     dose:2,   unit:'g',   cat:'antibiotic' },
  { name:'Sugammadex',    dose:200, unit:'mg',  cat:'reversal' }
];

ANES.DRUG_CATEGORIES = ['induction','opioid','nmb','reversal','vasopressor','inotrope',
  'antihypertensive','antibiotic','antiemetic','steroid','sedative','local anesthetic',
  'uterotonic','other'];

ANES.ROUTES = ['iv','im','po','sc','neuraxial','inhaled','topical','nerve block','other'];
/* The units an administration may be recorded in. Deliberately absolute.
   anesthesia_medications.dose is the amount that ENTERED THE PATIENT, and
   "2 mg/kg" is not an amount — it is a calculation that needs a weight to
   become one. Storing it in the dose column would make the record depend on a
   weight that may be estimated, may be corrected later, and is not carried on
   the row. A weight-normalised figure can be DERIVED for display from the
   actual dose and the case weight; it is never the stored administration.
   (Infusion RATES are a different thing and keep mcg/kg/min, which is a rate,
   not an amount.) */
ANES.DOSE_UNITS = ['mg','mcg','g','units','mL','mmol'];

/* The master timeline. Order is the order they normally occur, so the panel
   reads like the case does. Nothing here is compulsory — an ICU patient who
   arrives intubated never has an induction, and the chart must not imply one. */
ANES.MILESTONES = [
  { key:'or_in',              label:'Patient entered OR' },
  { key:'monitors_on',        label:'Monitoring started' },
  { key:'anesthesia_start',   label:'Anesthesia start' },
  { key:'preoxygenation',     label:'Preoxygenation' },
  { key:'induction_start',    label:'Induction start' },
  { key:'airway_secured',     label:'Airway secured' },
  { key:'block_start',        label:'Regional block start' },
  { key:'positioning',        label:'Positioning' },
  { key:'antibiotics',        label:'Antibiotic given' },
  { key:'surgery_start',      label:'Surgical start' },
  { key:'incision',           label:'Incision' },
  { key:'delivery',           label:'Delivery' },
  { key:'surgery_finish',     label:'Surgery finish' },
  { key:'emergence',          label:'Emergence' },
  { key:'extubation',         label:'Extubation' },
  { key:'anesthesia_finish',  label:'Anesthesia finish' },
  { key:'or_out',             label:'OR exit' },
  { key:'pacu_arrival',       label:'PACU arrival' },
  { key:'icu_arrival',        label:'ICU arrival' },
  { key:'handover_complete',  label:'Handover completed' }
];

ANES.FLUID_FAVOURITES = [
  { name:"Ringer's lactate",   category:'crystalloid', volume_ml:500 },
  { name:'Normal saline 0.9%', category:'crystalloid', volume_ml:500 },
  { name:'Plasma-Lyte',        category:'crystalloid', volume_ml:500 },
  { name:'Albumin 5%',         category:'colloid',     volume_ml:250 }
];
ANES.FLUID_CATEGORIES = ['crystalloid','colloid','glucose','other'];
ANES.BLOOD_PRODUCTS = ['rbc','ffp','platelets','cryoprecipitate','fibrinogen',
  'pcc','whole blood','cell saver'];
ANES.OUTPUT_KINDS = ['ebl','urine','suction','cell saver','ng','drain','ascites',
  'pleural','csf','other'];

ANES.EVENTS = ['hypotension','hypertension','bradycardia','tachycardia','desaturation',
  'difficult ventilation','bronchospasm','laryngospasm','difficult airway','aspiration',
  'anaphylaxis','major hemorrhage','arrhythmia','cardiac arrest','LAST','equipment failure'];
ANES.EVENT_SEVERITY = ['mild','moderate','severe','life-threatening'];

/* Vitals are stored as parameter/value/unit rows, so the set is open. These
   are the ones with a known unit and a place on the graph; anything else is
   recorded under a custom name with whatever unit the clinician states. */
ANES.VITAL_UNITS = { hr:'bpm', sbp:'mmHg', dbp:'mmHg', map:'mmHg', spo2:'%',
  etco2:'mmHg', temp:'°C', bis:'', tof:'%', cvp:'mmHg', pap:'mmHg',
  glucose:'mmol/L' };
/* Colour and axis grouping for the graph. Pressures share an axis because
   reading SBP against DBP is the point; SpO2 and BIS are percentages. */
ANES.VITAL_GRAPH = [
  { k:'sbp',   label:'SBP',   colour:'#FF8A80', axis:'pressure' },
  { k:'dbp',   label:'DBP',   colour:'#FFB4A8', axis:'pressure' },
  { k:'map',   label:'MAP',   colour:'#FF5252', axis:'pressure' },
  { k:'hr',    label:'HR',    colour:'#7ECFC0', axis:'pressure' },
  { k:'spo2',  label:'SpO₂',  colour:'#82B1FF', axis:'pct' },
  { k:'etco2', label:'EtCO₂', colour:'#FFD180', axis:'pressure' },
  { k:'bis',   label:'BIS',   colour:'#CE93D8', axis:'pct' },
  { k:'temp',  label:'Temp',  colour:'#A5D6A7', axis:'temp' }
];

ANES.ANESTHESIA_TYPES = ['general','spinal','epidural','combined spinal-epidural',
  'peripheral regional','MAC / sedation','local + sedation','TIVA','other'];
ANES.CASE_MODES = ['pediatric','neonatal','obstetric','cardiac','thoracic','neuro',
  'trauma','day case','remote location'];

ANES.HISTORY_TOPICS = [
  'cardiovascular','respiratory','neurologic','renal','hepatic','endocrine / diabetes',
  'hematologic','infectious','GI / GERD','obstructive sleep apnoea','pregnancy',
  'previous surgery','previous anesthesia','previous anesthesia complication',
  'difficult airway history','PONV','malignant hyperthermia','allergies',
  'current medications','anticoagulant / antiplatelet','implanted device','other'
];

ANES.MONITORS = {
  standard: ['ECG','NIBP','SpO₂','EtCO₂','Temperature','TOF','BIS / processed EEG'],
  advanced: ['Invasive arterial pressure','CVP','Pulmonary artery pressure','TEE','Other'],
  warming:  ['Forced-air warming','Fluid warmer','Other warming'],
  temperature_probe: ['Esophageal','Nasopharyngeal','Bladder','Rectal','Skin','Other']
};

ANES.ACCESS_KINDS = ['peripheral IV','arterial line','central venous catheter','PICC',
  'intraosseous','introducer','pulmonary artery catheter','dialysis catheter'];
/* Which fields make sense for which access type. Showing a lumen count for a
   peripheral cannula is how a form teaches a clinician to ignore it. */
ANES.ACCESS_FIELDS = {
  'peripheral IV':              ['site','side','gauge','ultrasound','attempts','patent'],
  'arterial line':              ['site','side','gauge','ultrasound','sterile_technique','attempts','waveform_confirmed','zeroed','patent'],
  'central venous catheter':    ['site','side','lumens','catheter_type','ultrasound','sterile_technique','attempts','waveform_confirmed','patent'],
  'PICC':                       ['site','side','lumens','catheter_type','ultrasound','sterile_technique','attempts','patent'],
  'intraosseous':               ['site','side','gauge','attempts','patent'],
  'introducer':                 ['site','side','gauge','ultrasound','sterile_technique','attempts','patent'],
  'pulmonary artery catheter':  ['site','side','lumens','catheter_type','ultrasound','sterile_technique','attempts','waveform_confirmed','zeroed','patent'],
  'dialysis catheter':          ['site','side','lumens','catheter_type','ultrasound','sterile_technique','attempts','patent']
};

ANES.REGIONAL_KINDS = ['peripheral block','spinal','epidural','combined spinal-epidural','caudal'];
ANES.NEURAXIAL_KINDS = ['spinal','epidural','combined spinal-epidural','caudal'];

ANES.VENT_MODES = ['spontaneous','VCV','PCV','PRVC','PSV','SIMV','one-lung ventilation','other'];

ANES.LAB_PANELS = ['ABG','VBG','CBC','chemistry','coagulation','ACT','TEG / ROTEM','other'];
ANES.ABG_ANALYTES = [
  { k:'pH',        unit:'' },      { k:'PaCO₂',   unit:'mmHg' },
  { k:'PaO₂',      unit:'mmHg' },  { k:'HCO₃',    unit:'mmol/L' },
  { k:'Base excess', unit:'mmol/L' }, { k:'Hb',    unit:'g/dL' },
  { k:'Hct',       unit:'%' },     { k:'Na',      unit:'mmol/L' },
  { k:'K',         unit:'mmol/L' },{ k:'Ionised Ca', unit:'mmol/L' },
  { k:'Glucose',   unit:'mmol/L' },{ k:'Lactate', unit:'mmol/L' }
];

ANES.HANDOFF_DESTINATIONS = ['PACU','ICU','ward','NICU','CCU','other'];

/* ═══════════ SMALL HELPERS ════════════════════════════════════════════════
   ageFrom returns a human age. Neonates are documented in days and infants in
   months because "0 years old" is useless on a chart where the dose depends on
   exactly how old this baby is. */
ANES.ageFrom = function(dob){
  if(!dob) return '';
  var b = new Date(dob), now = new Date();
  var days = Math.floor((now - b) / 86400000);
  if(days < 0) return '';
  if(days < 31) return days + (days === 1 ? ' day' : ' days');
  var months = (now.getFullYear()-b.getFullYear())*12 + (now.getMonth()-b.getMonth());
  if(now.getDate() < b.getDate()) months--;
  if(months < 24) return months + ' months';
  return Math.floor(months/12) + 'y';
};
ANES.bmi = function(kg, cm){
  if(!kg || !cm) return null;
  var m = cm/100;
  return (kg/(m*m)).toFixed(1);
};

/* Elapsed time since an intake, for the clinician's convenience ONLY.
   It is presentation, not a judgement: this function will never say a patient
   is fasted. Whether the interval is adequate for THIS patient, THIS airway
   and THIS operation is exactly the decision the chart exists to record, and
   a number computed by a web page is not entitled to make it. */
ANES.elapsedSince = function(iso){
  if(!iso) return null;
  var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if(!(mins === mins) || mins < 0) return null;
  var h = Math.floor(mins/60), m = mins % 60;
  return h ? (h + 'h ' + m + 'm ago') : (m + 'm ago');
};

/* ═══════════ THE BOOLEAN CONTRACT ═════════════════════════════════════════
   Forty columns in this schema are genuine PostgreSQL booleans, and the chart
   speaks in yes / no / unknown because "not asked" and "asked and the answer
   was no" are different clinical facts. Those two representations have to meet
   somewhere, and it must be exactly one place.

   What went wrong before this existed: PostgreSQL silently coerces 'yes' and
   'no' to true and false, so writes appeared to work — but 'unknown' is
   rejected outright, and reading back true and comparing it to 'yes' is always
   false. A difficult airway could be documented, stored correctly as true, and
   then never shown again: not in the header, not on the row, not on the
   timeline. The data was right and every reader was wrong.

   The contract:
     DB true  <-> UI 'yes'
     DB false <-> UI 'no'
     DB null  <-> UI 'unknown'   (and for a two-state field, simply unselected)

   toForm() is applied when a saved row is loaded into a form; fromForm() is
   applied inside every writer, so no call site can forget it. Display never
   compares by hand — it asks ANES.yes(), which accepts either representation
   and therefore cannot be broken by whichever side of the boundary it is on. */
ANES.BOOL_COLUMNS = {};
[
  'anesthesia_access.patent','anesthesia_access.placed_before_or',
  'anesthesia_access.sterile_technique','anesthesia_access.ultrasound',
  'anesthesia_access.waveform_confirmed','anesthesia_access.zeroed',
  'anesthesia_airway.bilateral_ventilation','anesthesia_airway.bronchoscopy_confirmed',
  'anesthesia_airway.difficult_airway','anesthesia_airway.etco2_confirmed',
  'anesthesia_blood_products.warmed','anesthesia_cases.asa_emergency',
  'anesthesia_fluids.warmed','anesthesia_handoffs.extubated',
  'anesthesia_handoffs.transferred_intubated','anesthesia_history_review.reviewed',
  'anesthesia_history_review.significant','anesthesia_medications.is_redose',
  'anesthesia_positioning.axillary_roll','anesthesia_positioning.eyes_protected',
  'anesthesia_positioning.padding','anesthesia_positioning.pressure_points_checked',
  'anesthesia_positioning.scds','anesthesia_preassessment.chewing_gum',
  'anesthesia_preassessment.facial_hair','anesthesia_preassessment.fasting_not_met_emergency',
  'anesthesia_regional.aspiration_negative','anesthesia_regional.blood_aspirated',
  'anesthesia_regional.catheter','anesthesia_regional.consent',
  'anesthesia_regional.csf_obtained','anesthesia_regional.incremental_injection',
  'anesthesia_regional.mask','anesthesia_regional.nerve_stimulator',
  'anesthesia_regional.paresthesia','anesthesia_regional.sterile_gloves',
  'anesthesia_regional.sterile_probe_cover','anesthesia_regional.sterile_technique',
  'anesthesia_regional.time_out','anesthesia_regional.ultrasound'
].forEach(function(c){ ANES.BOOL_COLUMNS[c] = true; });
ANES.isBoolColumn = function(table, col){ return !!ANES.BOOL_COLUMNS[table + '.' + col]; };

/* The one display predicate. Accepts a database boolean, a form string, and
   the strings a text column may legitimately hold, so a reader is right on
   both sides of the boundary and stays right if a column type ever changes. */
ANES.yes = function(v){ return v === true || v === 'yes' || v === 't' || v === 'true'; };
ANES.no  = function(v){ return v === false || v === 'no' || v === 'f' || v === 'false'; };
/* For a chip to light up. 'unknown' and null are the same answer: not recorded. */
ANES.uiBool = function(v){ return v == null ? 'unknown' : (ANES.yes(v) ? 'yes' : (ANES.no(v) ? 'no' : v)); };
ANES.dbBool = function(v){ return v === 'unknown' || v == null || v === '' ? null
                                : (ANES.yes(v) ? true : (ANES.no(v) ? false : null)); };

/* A stored row, ready to be edited. */
ANES.toForm = function(table, row){
  var out = {};
  if(!row) return out;
  Object.keys(row).forEach(function(k){
    out[k] = ANES.isBoolColumn(table, k) ? ANES.uiBool(row[k]) : row[k];
  });
  return out;
};
/* Form values, ready for the database. Applied inside every writer below. */
ANES.fromForm = function(table, obj){
  var out = {};
  if(!obj) return out;
  Object.keys(obj).forEach(function(k){
    out[k] = ANES.isBoolColumn(table, k) ? ANES.dbBool(obj[k]) : obj[k];
  });
  return out;
};

function nowIso(){ return new Date().toISOString(); }
async function uid(){ var s = await window.getSession(); return s ? s.user.id : null; }
ANES.nowIso = nowIso;

/* ═══════════ READS ════════════════════════════════════════════════════════
   Every table is pulled by the same function, and a table that FAILS is
   recorded as failed rather than returned as an empty array. A section that
   could not load must say so: "no airway recorded" and "the airway could not
   be read" are different facts, and showing the first when the second is true
   is how a chart quietly loses information. */
var TABLES = [
  ['times',        'anesthesia_case_times',      'occurred_at'],
  ['medications',  'anesthesia_medications',     'administered_at'],
  ['infusions',    'anesthesia_infusions',       'started_at'],
  ['infusionRates','anesthesia_infusion_rates',  'occurred_at'],
  ['fluids',       'anesthesia_fluids',          'started_at'],
  ['blood',        'anesthesia_blood_products',  'started_at'],
  ['outputs',      'anesthesia_outputs',         'recorded_at'],
  ['events',       'anesthesia_events',          'occurred_at'],
  ['vitals',       'anesthesia_vitals',          'measured_at'],
  ['regional',     'anesthesia_regional',        'started_at'],
  ['access',       'anesthesia_access',          'inserted_at'],
  ['airway',       'anesthesia_airway',          'occurred_at'],
  ['devices',      'anesthesia_device_sessions', 'started_at'],
  ['ventilation',  'anesthesia_ventilation',     'occurred_at'],
  ['positioning',  'anesthesia_positioning',     'occurred_at'],
  ['labs',         'anesthesia_labs',            'sampled_at'],
  ['history',      'anesthesia_history_review',  'created_at'],
  ['handoffs',     'anesthesia_handoffs',        'handoff_at'],
  ['amendments',   'anesthesia_amendments',      'amended_at']
];

ANES.loadCase = async function(caseId){
  var out = { case:null, milestones:{}, preassessment:null, errors:{} };
  TABLES.forEach(function(t){ out[t[0]] = []; });
  if(!caseId) return out;

  try {
    var c = await window.sb.from('anesthesia_cases').select('*').eq('id', caseId).maybeSingle();
    if(c.error){ out.errors.case = c.error.message; return out; }
    if(!c.data) return out;
    out.case = c.data;
  } catch(e){ out.errors.case = e.message; return out; }

  var pull = async function(key, table, order){
    try {
      var r = await window.sb.from(table).select('*').eq('case_id', caseId)
                .order(order, { ascending:true });
      if(r.error){ out.errors[key] = r.error.message; return; }
      out[key] = r.data || [];
    } catch(e){ out.errors[key] = e.message; }
  };

  await Promise.all(TABLES.map(function(t){ return pull(t[0], t[1], t[2]); }));

  // Pre-assessment is one row per case (its primary key is case_id).
  try {
    var p = await window.sb.from('anesthesia_preassessment').select('*')
              .eq('case_id', caseId).maybeSingle();
    if(p.error) out.errors.preassessment = p.error.message;
    else out.preassessment = p.data || null;
  } catch(e){ out.errors.preassessment = e.message; }

  (out.times || []).forEach(function(t){ out.milestones[t.milestone] = t.occurred_at; });
  return out;
};

ANES.listCases = async function(){
  try {
    var r = await window.sb.from('anesthesia_cases').select('*')
      .is('deleted_at', null).order('case_date', { ascending:false }).limit(100);
    return (r.error || !r.data) ? [] : r.data;
  } catch(e){ return []; }
};

/* ═══════════ WRITES ═══════════════════════════════════════════════════════
   entered_by is always the caller's own id. The RLS INSERT policies enforce
   entered_by = auth.uid(), so sending anything else would simply be refused —
   this just avoids constructing a payload the server is bound to reject.

   Every writer returns { error } and never throws: the page decides what to
   show, and a rejected write must always reach the clinician's eyes. */
function clean(row){
  var out = {};
  Object.keys(row).forEach(function(k){
    var v = row[k];
    if(v === undefined) return;
    if(v === '') { out[k] = null; return; }
    out[k] = v;
  });
  return out;
}

ANES.insert = async function(table, caseId, row){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var payload = clean(ANES.fromForm(table, row));
    payload.case_id = caseId; payload.entered_by = me;
    var r = await window.sb.from(table).insert(payload).select('*').maybeSingle();
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

ANES.update = async function(table, id, patch){
  try {
    var r = await window.sb.from(table).update(clean(ANES.fromForm(table, patch)))
              .eq('id', id).select('*').maybeSingle();
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

ANES.remove = async function(table, id){
  try {
    var r = await window.sb.from(table).delete().eq('id', id);
    return { error: r.error || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* The case header itself. anesthesia_case_editable() gates the UPDATE and
   anesthesia_guard_case_fields protects the columns that must not move, so
   this is a plain update: the server decides what is allowed to change. */
ANES.updateCase = async function(caseId, patch){
  try {
    var r = await window.sb.from('anesthesia_cases')
              .update(clean(ANES.fromForm('anesthesia_cases', patch)))
              .eq('id', caseId).select('*').maybeSingle();
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* Pre-assessment is 1:1 with the case, so a save is an upsert on case_id
   rather than a second row that contradicts the first. */
ANES.savePreassessment = async function(caseId, patch){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var payload = clean(ANES.fromForm('anesthesia_preassessment', patch));
    payload.case_id = caseId; payload.entered_by = me;
    if(!payload.assessed_at) payload.assessed_at = nowIso();
    var r = await window.sb.from('anesthesia_preassessment')
              .upsert(payload, { onConflict:'case_id' }).select('*').maybeSingle();
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

ANES.setMilestone = async function(caseId, milestone, when){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    // A milestone is unique per case, so re-tapping corrects the time rather
    // than producing two contradictory entries.
    var r = await window.sb.from('anesthesia_case_times')
      .upsert({ case_id:caseId, milestone:milestone, occurred_at:when || nowIso(), entered_by:me },
              { onConflict:'case_id,milestone' });
    return { error: r.error || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* A history topic is one row per (case, topic). Re-reviewing a topic updates
   the finding instead of stacking a second opinion on top of the first. */
ANES.saveHistory = async function(caseId, topic, patch){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var existing = await window.sb.from('anesthesia_history_review').select('id')
                     .eq('case_id', caseId).eq('topic', topic).maybeSingle();
    if(existing.error) return { error: existing.error };
    if(existing.data && existing.data.id)
      return await ANES.update('anesthesia_history_review', existing.data.id, patch);
    var row = clean(ANES.fromForm('anesthesia_history_review', patch));
    row.case_id = caseId; row.topic = topic; row.entered_by = me;
    var r = await window.sb.from('anesthesia_history_review').insert(row).select('*').maybeSingle();
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* Named writers kept for the quick actions, so a one-tap button stays one
   line at the call site. */
ANES.addMedication = function(caseId, d){
  return ANES.insert('anesthesia_medications', caseId, {
    administered_at: d.administered_at || nowIso(), medication: d.medication,
    category: d.category, dose: d.dose, unit: d.unit,
    concentration: d.concentration, route: d.route || 'iv', line: d.line,
    indication: d.indication, is_redose: !!d.is_redose,
    administered_by: d.administered_by, note: d.note });
};
ANES.addFluid = function(caseId, d){
  return ANES.insert('anesthesia_fluids', caseId, {
    fluid: d.fluid, category: d.category, volume_ml: d.volume_ml,
    started_at: d.started_at || nowIso(), finished_at: d.finished_at,
    warmed: d.warmed == null ? null : !!d.warmed, line: d.line, note: d.note });
};
ANES.addBlood = function(caseId, d){
  return ANES.insert('anesthesia_blood_products', caseId, {
    product: d.product, units: d.units, volume_ml: d.volume_ml,
    unit_identifier: d.unit_identifier, started_at: d.started_at || nowIso(),
    finished_at: d.finished_at, warmed: d.warmed == null ? null : !!d.warmed,
    reaction: d.reaction, note: d.note });
};
ANES.addOutput = function(caseId, d){
  return ANES.insert('anesthesia_outputs', caseId, {
    recorded_at: d.recorded_at || nowIso(), kind: d.kind,
    volume_ml: d.volume_ml, label: d.label, note: d.note });
};
ANES.addEvent = function(caseId, d){
  return ANES.insert('anesthesia_events', caseId, {
    occurred_at: d.occurred_at || nowIso(), category: d.category || 'complication',
    event_type: d.event_type, severity: d.severity, description: d.description,
    treatment: d.treatment, response: d.response, outcome: d.outcome,
    resolved_at: d.resolved_at });
};
ANES.addVital = function(caseId, d){
  return ANES.insert('anesthesia_vitals', caseId, {
    measured_at: d.measured_at || nowIso(), parameter: d.parameter,
    value: d.value, unit: d.unit,
    // 'manual' always: this project has no device integration, and a record
    // that claims a monitor produced a number a human typed is a record that
    // lies about its own provenance. When a device is one day connected it
    // writes its own rows to this same table with its own source, and nothing
    // above this line has to change.
    source: 'manual' });
};
ANES.addInfusionRate = function(caseId, infusionId, rate, when){
  return ANES.insert('anesthesia_infusion_rates', caseId, {
    infusion_id: infusionId, rate: rate, occurred_at: when || nowIso() });
};

/* Lifecycle goes through the RPCs, never a direct UPDATE: they are the only
   things that can write finalized_by/finalized_at and guarantee the audit row. */
/* A v4 UUID from the browser. The case id is generated HERE, deliberately —
   see createCase below for why the database cannot hand one back. */
ANES.newId = function(){
  try { if(global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID(); } catch(e){}
  var b;
  try {
    b = new Uint8Array(16); global.crypto.getRandomValues(b);
  } catch(e){
    b = []; for(var i=0;i<16;i++) b.push(Math.floor(Math.random()*256));
  }
  b[6] = (b[6] & 0x0f) | 0x40;            // version 4
  b[8] = (b[8] & 0x3f) | 0x80;            // variant 10
  var h = [];
  for(var j=0;j<16;j++) h.push(('0' + b[j].toString(16)).slice(-2));
  return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('') +
         '-' + h.slice(8,10).join('') + '-' + h.slice(10,16).join('');
};

/* Creating a case does NOT ask the database to return the new id.

   anes_case_select is anesthesia_case_access(id), a SECURITY DEFINER STABLE
   function that re-queries anesthesia_cases. During INSERT ... RETURNING —
   which is exactly what supabase-js issues for .insert().select() — PostgreSQL
   evaluates the SELECT policy against the new row, but a STABLE function runs
   on the statement's snapshot and therefore cannot see the row being inserted.
   EXISTS comes back false, the RETURNING is refused, and the whole INSERT
   fails with "new row violates row-level security policy". Proved on a replica:
   the identical INSERT without RETURNING succeeds, and the row is readable the
   moment it exists.

   So the client supplies the id, inserts without RETURNING, and then READS the
   row back. The read is not ceremony: it proves both that the row landed and
   that this caller can open it, so a redirect can never send a clinician to a
   record they will be refused. */
ANES.createCase = async function(data){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var row = clean(ANES.fromForm('anesthesia_cases', {
      display_name: data.display_name, mrn: data.mrn,
      date_of_birth: data.date_of_birth, sex: data.sex,
      weight_kg: data.weight_kg, height_cm: data.height_cm,
      asa_class: data.asa_class, allergies: data.allergies,
      diagnosis: data.diagnosis, planned_procedure: data.planned_procedure,
      surgeon: data.surgeon, operating_room: data.operating_room,
      urgency: data.urgency || 'elective',
      surgery_id: data.surgery_id, clinic_patient_id: data.clinic_patient_id
    }));
    row.anesthesia_types = data.anesthesia_types || [];
    row.case_modes = data.case_modes || [];
    row.status = 'in_progress';
    row.anesthesiologist_id = me; row.created_by = me;
    row.id = ANES.newId();

    var r = await window.sb.from('anesthesia_cases').insert(row);   // no RETURNING
    if(r && r.error) return { error:r.error };

    var v = await window.sb.from('anesthesia_cases').select('id').eq('id', row.id).maybeSingle();
    if(v && v.error) return { error:v.error };
    if(!v || !v.data){
      return { error:{ message:'The record was created but could not be opened. ' +
        'Your account may not have permission to chart this case.' } };
    }
    return { error:null, id: row.id };
  } catch(e){ return { error:{ message:e.message } }; }
};

ANES.finalize = async function(caseId){
  try {
    var r = await window.sb.rpc('anesthesia_finalize_case', { p_case: caseId });
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};
ANES.amend = async function(caseId, area, original, amendment, reason){
  try {
    var r = await window.sb.rpc('anesthesia_amend_case',
      { p_case:caseId, p_area:area, p_original:original, p_amendment:amendment, p_reason:reason });
    return { error: r.error || null, data: r.data || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* ═══════════ FIELD DESCRIPTIONS ═══════════════════════════════════════════
   type:
     text | num | area        typed input (kept to a minimum)
     choice                   one tap from a list; 'other' reveals free text
     multi                    several may be true at once
     tri                      yes / no / unknown — never a checkbox, because an
                              unticked box and "no" are different clinical facts
     bool                     yes / no
     time                     a timestamp, with a "now" button
   only: shown only when another field has one of the given values (progressive
   disclosure — an epidural does not need a Cormack-Lehane grade). */
function F(k, label, type, opts){
  var f = { k:k, label:label, type:type||'text' };
  if(opts) Object.keys(opts).forEach(function(x){ f[x] = opts[x]; });
  return f;
}
ANES.F = F;

ANES.FORMS = {};

/* ── Pre-assessment: fasting ─────────────────────────────────────────────── */
ANES.FORMS.fasting = {
  table:'anesthesia_preassessment', single:true,
  fields: [
    F('fasting_status','Fasting status','choice',{ options:['yes','no','unknown'] }),
    F('last_solid_at','Last solid food','time',{ elapsed:true }),
    F('last_light_meal_at','Last light meal','time',{ elapsed:true }),
    F('last_clear_fluid_at','Last clear fluids','time',{ elapsed:true }),
    F('last_breast_milk_at','Last breast milk','time',{ elapsed:true, peds:true }),
    F('last_formula_at','Last formula','time',{ elapsed:true, peds:true }),
    F('other_intake','Other oral intake','text'),
    F('chewing_gum','Chewing gum','tri'),
    F('fasting_unavailable_reason','Fasting information unavailable — reason','text'),
    F('fasting_not_met_emergency','Proceeding despite inadequate fasting','tri'),
    F('why_cannot_wait','Why the surgery cannot wait','area',
      { only:{ fasting_not_met_emergency:['yes'] } }),
    F('aspiration_risk_note','Aspiration risk','area'),
    F('anesthesiologist_plan','Anesthesiologist plan','area')
  ]
};

/* ── Pre-assessment: airway examination ──────────────────────────────────── */
ANES.FORMS.airwayAssessment = {
  table:'anesthesia_preassessment', single:true,
  fields: [
    F('mouth_opening_cm','Mouth opening (cm)','num'),
    F('mallampati','Mallampati','choice',{ options:['I','II','III','IV'] }),
    F('thyromental_distance_cm','Thyromental distance (cm)','num'),
    F('neck_movement','Neck movement','choice',{ options:['full','reduced','fixed'] }),
    F('dentition','Dentition','choice',
      { options:['intact','loose tooth','crowns / caps','edentulous','dentures','poor'] }),
    F('facial_hair','Beard / facial hair','tri'),
    F('anticipated_mask_difficulty','Anticipated mask difficulty','choice',
      { options:['none','possible','likely'] }),
    F('anticipated_intubation_difficulty','Anticipated intubation difficulty','choice',
      { options:['none','possible','likely'] }),
    F('prior_airway_info','Previous airway information','area'),
    F('airway_plan','Airway plan','area'),
    F('airway_backup_plan','Backup airway plan','area')
  ]
};

/* ── Pre-assessment: investigations ──────────────────────────────────────── */
ANES.FORMS.investigations = {
  table:'anesthesia_preassessment', single:true,
  fields: [
    F('ecg_findings','ECG','text'),
    F('chest_imaging_findings','Chest imaging','text'),
    F('echo_findings','Echocardiogram','text'),
    F('ejection_fraction_pct','Ejection fraction (%)','num'),
    F('valve_disease','Valve disease','text'),
    F('pulmonary_hypertension','Pulmonary hypertension','tri'),
    F('other_investigations','Other investigations','area'),
    F('type_and_screen','Type and screen','text'),
    F('notes','Pre-assessment notes','area')
  ]
};

/* ── Intra-operative airway ──────────────────────────────────────────────── */
ANES.FORMS.airway = {
  table:'anesthesia_airway', timeKey:'occurred_at',
  fields: [
    F('occurred_at','Time','time'),
    F('preoxygenation_method','Preoxygenation','choice',
      { options:['face mask','circuit','HFNO','NIV','none'] }),
    F('preoxygenation_fio2','Preoxygenation FiO₂ (%)','num'),
    F('preoxygenation_minutes','Preoxygenation (minutes)','num'),
    F('eto2_pct','EtO₂ achieved (%)','num'),
    F('mask_ventilation','Mask ventilation','choice',
      { options:['easy','difficult','impossible','not attempted'] }),
    F('mask_adjunct','Mask adjunct','choice',
      { options:['none','oropharyngeal','nasopharyngeal','two-person'] }),
    F('technique','Technique','choice',
      { options:['direct laryngoscopy','videolaryngoscopy','fibreoptic','supraglottic',
                 'awake fibreoptic','tracheostomy','face mask only','other'] }),
    F('device','Device','choice',
      { options:['ETT','LMA','i-gel','double-lumen tube','bronchial blocker',
                 'tracheostomy','face mask','other'] }),
    F('device_size','Size','text'),
    F('route','Route','choice',{ options:['oral','nasal','stoma'],
      only:{ device:['ETT','double-lumen tube','other'] } }),
    F('depth_cm','Depth at teeth / nares (cm)','num'),
    F('blade','Blade','choice',{ options:['Macintosh','Miller','hyperangulated','channelled','other'],
      only:{ technique:['direct laryngoscopy','videolaryngoscopy'] } }),
    F('blade_size','Blade size','text', { only:{ technique:['direct laryngoscopy','videolaryngoscopy'] } }),
    F('cormack_lehane','Cormack-Lehane','choice',{ options:['1','2a','2b','3a','3b','4'],
      only:{ technique:['direct laryngoscopy','videolaryngoscopy'] } }),
    F('attempts','Attempts','num'),
    F('operator','Operator','text'),
    F('adjunct','Adjunct','choice',{ options:['none','bougie','stylet','exchange catheter','other'] }),
    F('cuff_pressure_cmh2o','Cuff pressure (cmH₂O)','num'),
    F('etco2_confirmed','EtCO₂ confirmed','tri'),
    F('bilateral_ventilation','Bilateral ventilation confirmed','tri'),
    F('bronchoscopy_confirmed','Position confirmed bronchoscopically','tri'),
    F('difficult_airway','Difficult airway','tri', { flag:true }),
    F('complication','Complication','text'),
    F('olv_started_at','One-lung ventilation started','time'),
    F('olv_ended_at','One-lung ventilation ended','time'),
    F('note','Note','area')
  ]
};

/* ── Vascular access ─────────────────────────────────────────────────────── */
ANES.FORMS.access = {
  table:'anesthesia_access', timeKey:'inserted_at',
  fields: [
    F('kind','Type','choice',{ options:ANES.ACCESS_KINDS, drives:true }),
    F('inserted_at','Inserted','time'),
    F('site','Site','text'),
    F('side','Side','choice',{ options:['left','right','midline'] }),
    F('gauge','Gauge','text'),
    F('lumens','Lumens','num'),
    F('catheter_type','Catheter type','text'),
    F('placed_before_or','Pre-existing (not placed in OR)','tri'),
    F('ultrasound','Ultrasound guided','tri'),
    F('sterile_technique','Full sterile technique','tri'),
    F('attempts','Attempts','num'),
    F('waveform_confirmed','Waveform confirmed','tri'),
    F('zeroed','Zeroed / levelled','tri'),
    F('patent','Patent','tri'),
    F('complications','Complications','text'),
    F('note','Note','area')
  ]
};

/* ── Positioning ─────────────────────────────────────────────────────────── */
ANES.FORMS.positioning = {
  table:'anesthesia_positioning', timeKey:'occurred_at',
  fields: [
    F('occurred_at','Time','time'),
    F('position','Position','choice',
      { options:['supine','prone','lateral','lithotomy','beach chair','sitting','other'] }),
    F('arms','Arms','choice',{ options:['tucked','abducted <90°','abducted >90°','over head','one out'] }),
    F('padding','Padding applied','tri'),
    F('eyes_protected','Eyes protected','tri'),
    F('pressure_points_checked','Pressure points checked','tri'),
    F('head_neck','Head and neck','text'),
    F('axillary_roll','Axillary roll','tri'),
    F('scds','Sequential compression devices','tri'),
    F('precautions','Special precautions','area'),
    F('note','Note','area')
  ]
};

/* ── Ventilation ─────────────────────────────────────────────────────────── */
ANES.FORMS.ventilation = {
  table:'anesthesia_ventilation', timeKey:'occurred_at',
  fields: [
    F('occurred_at','Time','time'),
    F('mode','Mode','choice',{ options:ANES.VENT_MODES }),
    F('tidal_volume_ml','Tidal volume (mL)','num'),
    F('respiratory_rate','Respiratory rate','num'),
    F('peep_cmh2o','PEEP (cmH₂O)','num'),
    F('fio2_pct','FiO₂ (%)','num'),
    F('ie_ratio','I:E','text'),
    F('pressure_control_cmh2o','Pressure control (cmH₂O)','num'),
    F('peak_pressure_cmh2o','Peak pressure (cmH₂O)','num'),
    F('plateau_pressure_cmh2o','Plateau pressure (cmH₂O)','num'),
    F('minute_ventilation_l','Minute ventilation (L/min)','num'),
    F('note','Note','area')
  ]
};

/* ── Regional ────────────────────────────────────────────────────────────── */
ANES.FORMS.regional = {
  table:'anesthesia_regional', timeKey:'started_at',
  fields: [
    F('kind','Technique','choice',{ options:ANES.REGIONAL_KINDS, drives:true }),
    F('block_name','Block','text',{ only:{ kind:['peripheral block'] } }),
    F('side','Side','choice',{ options:['left','right','bilateral','midline'] }),
    F('started_at','Started','time'),
    F('finished_at','Finished','time'),
    F('indication','Indication','text'),
    F('consent','Consent obtained','tri'),
    F('time_out','Time-out performed','tri'),
    F('patient_position','Position','choice',{ options:['sitting','lateral','prone','supine'] }),
    F('sterile_technique','Sterile technique','tri'),
    F('skin_prep','Skin preparation','text'),
    F('sterile_gloves','Sterile gloves','tri'),
    F('mask','Mask worn','tri'),
    F('sterile_probe_cover','Sterile probe cover','tri'),
    F('ultrasound','Ultrasound','tri'),
    F('nerve_stimulator','Nerve stimulator','tri'),
    F('needle_type','Needle','text'),
    F('needle_gauge','Needle gauge','text'),
    F('needle_length_cm','Needle length (cm)','num'),
    F('attempts','Attempts','num'),
    F('aspiration_negative','Negative aspiration','tri'),
    F('incremental_injection','Incremental injection','tri'),
    F('injection_pressure','Injection pressure','choice',{ options:['normal','high','not monitored'] }),
    // Neuraxial only
    F('vertebral_level','Vertebral level','text',{ only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('approach','Approach','choice',{ options:['midline','paramedian','caudal'],
      only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('csf_obtained','CSF obtained','tri',{ only:{ kind:['spinal','combined spinal-epidural'] } }),
    F('paresthesia','Paraesthesia','tri',{ only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('blood_aspirated','Blood aspirated','tri',{ only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('test_dose','Test dose','text',{ only:{ kind:['epidural','combined spinal-epidural','caudal'] } }),
    F('sensory_level','Sensory level','text',{ only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('motor_block','Motor block','text',{ only:{ kind:ANES.NEURAXIAL_KINDS } }),
    F('catheter','Catheter sited','tri'),
    F('catheter_depth_cm','Catheter depth (cm)','num'),
    // Local anaesthetic
    F('local_anesthetic','Local anaesthetic','text'),
    F('la_concentration','Concentration','text'),
    F('la_volume_ml','Volume (mL)','num'),
    F('la_total_mg','Total dose (mg)','num'),
    F('adjuvant','Adjuvant','text'),
    F('assessment','Assessment','area'),
    F('complications','Complications','text'),
    F('note','Note','area')
  ]
};

/* ── Events ──────────────────────────────────────────────────────────────── */
ANES.FORMS.event = {
  table:'anesthesia_events', timeKey:'occurred_at',
  fields: [
    F('occurred_at','Time','time'),
    F('event_type','Event','choice',{ options:ANES.EVENTS }),
    F('severity','Severity','choice',{ options:ANES.EVENT_SEVERITY }),
    F('description','Description','area'),
    F('treatment','Treatment','area'),
    F('response','Response','area'),
    F('outcome','Outcome','choice',{ options:['resolved','ongoing','improved','worsened','death'] }),
    F('resolved_at','Resolved','time')
  ]
};

/* ── Emergence and handoff. One row carries both: emergence IS the end of the
      anesthetic and the beginning of the handover, and splitting them across
      two records is how the reversal dose ends up in neither. ────────────── */
ANES.FORMS.handoff = {
  table:'anesthesia_handoffs', timeKey:'handoff_at',
  fields: [
    F('volatile_stopped_at','Volatile stopped','time',{ group:'Emergence' }),
    F('infusions_stopped_at','Infusions stopped','time',{ group:'Emergence' }),
    F('tof_ratio','TOF ratio','num',{ group:'Emergence' }),
    F('reversal_agent','Reversal agent','choice',
      { options:['none','sugammadex','neostigmine + glycopyrrolate','neostigmine'], group:'Emergence' }),
    F('reversal_dose','Reversal dose','text',{ group:'Emergence' }),
    F('reversal_at','Reversal given','time',{ group:'Emergence' }),
    F('extubated','Extubated','tri',{ group:'Emergence', drives:true }),
    F('extubation_at','Extubation time','time',{ group:'Emergence', only:{ extubated:['yes'] } }),
    F('extubation_type','Extubation','choice',{ options:['awake','deep'],
      group:'Emergence', only:{ extubated:['yes'] } }),
    F('transferred_intubated','Transferred intubated','tri',{ group:'Emergence' }),
    F('airway_at_transfer','Airway at transfer','text',{ group:'Emergence' }),

    F('destination','Destination','choice',{ options:ANES.HANDOFF_DESTINATIONS, group:'Handoff' }),
    F('handoff_at','Handoff time','time',{ group:'Handoff' }),
    F('oxygen_device','Oxygen device','choice',
      { options:['room air','nasal cannula','face mask','venturi','non-rebreather','HFNO','ventilator'],
        group:'Handoff' }),
    F('ventilation','Ventilation','text',{ group:'Handoff' }),
    F('bp','Blood pressure','text',{ group:'Handoff' }),
    F('hr','Heart rate','num',{ group:'Handoff' }),
    F('spo2','SpO₂ (%)','num',{ group:'Handoff' }),
    F('temperature_c','Temperature (°C)','num',{ group:'Handoff' }),
    F('pain_score','Pain score','text',{ group:'Handoff' }),
    F('sedation_score','Sedation score','text',{ group:'Handoff' }),
    F('ponv','PONV','tri',{ group:'Handoff' }),
    F('neuro_status','Neurological status','text',{ group:'Handoff' }),
    F('ongoing_infusions','Ongoing infusions','area',{ group:'Handoff' }),
    F('lines_drains','Lines and drains','area',{ group:'Handoff' }),
    F('antibiotics_given','Antibiotics given','text',{ group:'Handoff' }),
    F('key_events','Key events','area',{ group:'Handoff' }),
    F('postoperative_plan','Postoperative plan','area',{ group:'Handoff' }),
    F('recipient_name','Received by','text',{ group:'Handoff' }),
    F('recipient_role','Recipient role','choice',
      { options:['nurse','anesthesiologist','intensivist','resident','other'], group:'Handoff' }),
    F('transferring_clinician','Handed over by','text',{ group:'Handoff' })
  ]
};

/* ── Correction forms ────────────────────────────────────────────────────
   A clinical chart that can only be appended to is not a chart, it is a log.
   Before finalization the clinician must be able to correct what they wrote —
   a 7.5 tube typed when a 7.0 went in has to become a 7.0, not a second
   contradictory row. These describe the quick-entry tables so the SAME
   renderer edits them, and the update goes to the row that already exists. */
ANES.FORMS.medication = {
  table:'anesthesia_medications', timeKey:'administered_at',
  fields: [
    F('administered_at','Time','time'),
    F('medication','Medication','text'),
    F('dose','Dose','num'),
    F('unit','Unit','choice',{ options:ANES.DOSE_UNITS }),
    F('route','Route','choice',{ options:ANES.ROUTES }),
    F('category','Category','choice',{ options:ANES.DRUG_CATEGORIES }),
    F('concentration','Concentration','text'),
    F('line','Line','text'),
    F('indication','Indication','text'),
    F('administered_by','Administered by','text'),
    F('is_redose','Redose','bool'),
    F('note','Note','area')
  ]
};
ANES.FORMS.infusion = {
  table:'anesthesia_infusions', timeKey:'started_at',
  fields: [
    F('medication','Medication','text'), F('concentration','Concentration','text'),
    F('rate_unit','Rate unit','text'), F('line','Line','text'),
    F('tci_model','TCI model','text'),
    F('tci_target_kind','TCI target','choice',{ options:['plasma','effect-site'] }),
    F('started_at','Started','time'), F('stopped_at','Stopped','time'),
    F('total_given','Total given','num'), F('total_unit','Total unit','text'),
    F('note','Note','area')
  ]
};
ANES.FORMS.fluid = {
  table:'anesthesia_fluids', timeKey:'started_at',
  fields: [
    F('fluid','Fluid','text'),
    F('category','Category','choice',{ options:ANES.FLUID_CATEGORIES }),
    F('volume_ml','Volume (mL)','num'),
    F('started_at','Started','time'), F('finished_at','Finished','time'),
    F('warmed','Warmed','tri'), F('line','Line','text'), F('note','Note','area')
  ]
};
ANES.FORMS.blood = {
  table:'anesthesia_blood_products', timeKey:'started_at',
  fields: [
    F('product','Product','choice',{ options:ANES.BLOOD_PRODUCTS }),
    F('units','Units','num'), F('volume_ml','Volume (mL)','num'),
    F('unit_identifier','Unit identifier','text'),
    F('started_at','Started','time'), F('finished_at','Finished','time'),
    F('warmed','Warmed','tri'), F('reaction','Reaction','text'), F('note','Note','area')
  ]
};
ANES.FORMS.output = {
  table:'anesthesia_outputs', timeKey:'recorded_at',
  fields: [
    F('kind','Kind','choice',{ options:ANES.OUTPUT_KINDS }),
    F('volume_ml','Volume (mL)','num'), F('recorded_at','Time','time'),
    F('label','Label','text'), F('note','Note','area')
  ]
};
ANES.FORMS.vital = {
  table:'anesthesia_vitals', timeKey:'measured_at',
  fields: [
    F('parameter','Parameter','text'), F('value','Value','num'),
    F('unit','Unit','text'), F('measured_at','Time','time')
  ]
};
ANES.FORMS.lab = {
  table:'anesthesia_labs', timeKey:'sampled_at',
  fields: [
    F('panel','Panel','choice',{ options:ANES.LAB_PANELS }),
    F('analyte','Analyte','text'), F('value','Value','num'),
    F('value_text','Value (text)','text'), F('unit','Unit','text'),
    F('sampled_at','Sampled','time')
  ]
};
ANES.FORMS.device = {
  table:'anesthesia_device_sessions', timeKey:'started_at',
  fields: [
    F('label','Device','text'), F('kind','Kind','text'),
    F('category','Category','text'),
    F('started_at','Started','time'), F('stopped_at','Stopped','time'),
    F('note','Note','area')
  ]
};

/* Which form edits which list, and how a row is titled in the confirmation
   when it is about to be removed. */
ANES.EDITABLE = {
  medications:  { spec:'medication',  table:'anesthesia_medications',
                  label:function(r){ return r.medication + ' ' + (+r.dose) + ' ' + (r.unit||''); } },
  infusions:    { spec:'infusion',    table:'anesthesia_infusions',
                  label:function(r){ return r.medication + ' infusion'; } },
  fluids:       { spec:'fluid',       table:'anesthesia_fluids',
                  label:function(r){ return r.fluid + ' ' + (+r.volume_ml) + ' mL'; } },
  blood:        { spec:'blood',       table:'anesthesia_blood_products',
                  label:function(r){ return String(r.product).toUpperCase(); } },
  outputs:      { spec:'output',      table:'anesthesia_outputs',
                  label:function(r){ return String(r.kind).toUpperCase() + ' ' + (+r.volume_ml) + ' mL'; } },
  vitals:       { spec:'vital',       table:'anesthesia_vitals',
                  label:function(r){ return String(r.parameter).toUpperCase() + ' ' + (+r.value); } },
  labs:         { spec:'lab',         table:'anesthesia_labs',
                  label:function(r){ return r.analyte + ' ' + (r.value != null ? (+r.value) : (r.value_text||'')); } },
  devices:      { spec:'device',      table:'anesthesia_device_sessions',
                  label:function(r){ return r.label || r.kind; } },
  airway:       { spec:'airway',      table:'anesthesia_airway',
                  label:function(r){ return [r.device, r.device_size].filter(Boolean).join(' ') || 'airway record'; } },
  access:       { spec:'access',      table:'anesthesia_access',
                  label:function(r){ return [r.gauge, r.kind].filter(Boolean).join(' '); } },
  positioning:  { spec:'positioning', table:'anesthesia_positioning',
                  label:function(r){ return r.position; } },
  ventilation:  { spec:'ventilation', table:'anesthesia_ventilation',
                  label:function(r){ return (r.mode || 'ventilation') + ' settings'; } },
  regional:     { spec:'regional',    table:'anesthesia_regional',
                  label:function(r){ return r.block_name || r.kind; } },
  events:       { spec:'event',       table:'anesthesia_events',
                  label:function(r){ return r.event_type; } }
};

/* ── Case header, editable while the record is open ──────────────────────── */
ANES.FORMS.caseHeader = {
  table:'anesthesia_cases', single:true,
  fields: [
    F('display_name','Patient name','text'),
    F('mrn','MRN','text'),
    F('date_of_birth','Date of birth','date'),
    F('sex','Sex','choice',{ options:['female','male','other','unknown'] }),
    F('weight_kg','Weight (kg)','num'),
    F('height_cm','Height (cm)','num'),
    F('asa_class','ASA','choice',{ options:['I','II','III','IV','V','VI'] }),
    F('asa_emergency','E modifier','bool'),
    F('allergies','Allergies','area'),
    F('diagnosis','Diagnosis','text'),
    F('planned_procedure','Planned procedure','text'),
    F('actual_procedure','Actual procedure','text'),
    F('surgical_specialty','Specialty','text'),
    F('surgeon','Surgeon','text'),
    F('assistant','Assistant','text'),
    F('trainee_name','Trainee','text'),
    F('operating_room','OR / location','text'),
    F('site','Site','text'),
    F('urgency','Urgency','choice',{ options:['elective','urgent','emergency'] }),
    F('anesthesia_types','Anesthesia type','multi',{ options:ANES.ANESTHESIA_TYPES }),
    F('case_modes','Case modes','multi',{ options:ANES.CASE_MODES })
  ]
};

/* ═══════════ DERIVED VIEWS ════════════════════════════════════════════════
   The timeline merges every source into one chronological list, because that
   is how the case actually happened and how a reader reconstructs it. */
ANES.buildTimeline = function(d){
  var rows = [];
  var label = {};
  ANES.MILESTONES.forEach(function(m){ label[m.key] = m.label; });
  var push = function(at, cls, text, meta){ if(at) rows.push({ at:at, cls:cls||'', text:text, meta:meta||null }); };

  (d.times || []).forEach(function(t){
    push(t.occurred_at, 'milestone', label[t.milestone] || t.milestone, t.note); });
  (d.medications || []).forEach(function(m){
    push(m.administered_at, '', m.medication + ' ' + (+m.dose) + ' ' + m.unit +
      (m.route ? ' ' + String(m.route).toUpperCase() : ''),
      [m.is_redose ? 'redose' : null, m.indication].filter(Boolean).join(' · ') || null); });
  (d.infusions || []).forEach(function(i){
    push(i.started_at, 'inf', i.medication + ' infusion started',
      [i.concentration, i.rate_unit].filter(Boolean).join(' · ') || null);
    push(i.stopped_at, 'inf', i.medication + ' infusion stopped',
      i.total_given ? ('total ' + (+i.total_given) + ' ' + (i.total_unit||'')) : null); });
  (d.infusionRates || []).forEach(function(r){
    var inf = (d.infusions || []).filter(function(x){ return x.id === r.infusion_id; })[0];
    push(r.occurred_at, 'inf', (inf ? inf.medication : 'Infusion') + ' rate ' + (+r.rate) +
      (inf && inf.rate_unit ? ' ' + inf.rate_unit : '')); });
  (d.fluids || []).forEach(function(f){
    push(f.started_at, '', f.fluid + ' ' + (+f.volume_ml) + ' mL',
      ANES.yes(f.warmed) ? 'warmed' : null); });
  (d.blood || []).forEach(function(b){
    push(b.started_at, 'ev', String(b.product).toUpperCase() +
      (b.units ? ' ' + (+b.units) + ' unit(s)' : ''),
      [b.unit_identifier, b.reaction ? 'REACTION: ' + b.reaction : null].filter(Boolean).join(' · ') || null); });
  (d.outputs || []).forEach(function(o){
    push(o.recorded_at, '', String(o.kind).toUpperCase() + ' ' + (+o.volume_ml) + ' mL', o.label); });
  (d.airway || []).forEach(function(a){
    push(a.occurred_at, ANES.yes(a.difficult_airway) ? 'ev' : '',
      'Airway: ' + [a.device, a.device_size].filter(Boolean).join(' ') +
      (a.technique ? ' via ' + a.technique : ''),
      [a.cormack_lehane ? 'CL ' + a.cormack_lehane : null,
       a.attempts ? a.attempts + ' attempt(s)' : null,
       ANES.yes(a.difficult_airway) ? 'DIFFICULT AIRWAY' : null].filter(Boolean).join(' · ') || null);
    push(a.olv_started_at, '', 'One-lung ventilation started');
    push(a.olv_ended_at, '', 'One-lung ventilation ended'); });
  (d.access || []).forEach(function(a){
    push(a.inserted_at, '', (a.gauge ? a.gauge + ' ' : '') + String(a.kind).replace(/_/g,' ') +
      (a.site ? ' — ' + a.site : '') + (a.side ? ' (' + a.side + ')' : ''),
      a.complications || null); });
  (d.devices || []).forEach(function(v){
    push(v.started_at, '', (v.label || v.kind) + ' started');
    push(v.stopped_at, '', (v.label || v.kind) + ' stopped'); });
  (d.ventilation || []).forEach(function(v){
    push(v.occurred_at, '', 'Ventilation ' + (v.mode || '') +
      [v.tidal_volume_ml ? ' VT ' + v.tidal_volume_ml : '',
       v.respiratory_rate ? ' RR ' + v.respiratory_rate : '',
       v.peep_cmh2o != null ? ' PEEP ' + v.peep_cmh2o : '',
       v.fio2_pct ? ' FiO₂ ' + v.fio2_pct + '%' : ''].join('')); });
  (d.positioning || []).forEach(function(p){
    push(p.occurred_at, '', 'Positioned ' + p.position, p.precautions || null); });
  (d.regional || []).forEach(function(r){
    push(r.started_at, '', (r.block_name || r.kind) + (r.side ? ' (' + r.side + ')' : ''),
      [r.local_anesthetic, r.la_volume_ml ? r.la_volume_ml + ' mL' : null,
       r.complications].filter(Boolean).join(' · ') || null); });
  (d.labs || []).forEach(function(l){
    push(l.sampled_at, '', (l.panel || 'Lab') + ' ' + l.analyte + ' ' +
      (l.value != null ? (+l.value) : (l.value_text || '')) + (l.unit ? ' ' + l.unit : '')); });
  (d.events || []).forEach(function(e){
    push(e.occurred_at, 'ev', e.event_type + (e.severity ? ' (' + e.severity + ')' : ''),
      [e.description, e.treatment, e.outcome].filter(Boolean).join(' · ') || null);
    push(e.resolved_at, '', e.event_type + ' resolved'); });
  (d.handoffs || []).forEach(function(h){
    push(h.extubation_at, 'milestone', 'Extubated' + (h.extubation_type ? ' (' + h.extubation_type + ')' : ''));
    push(h.handoff_at, 'milestone', 'Handover to ' + (h.destination || 'destination'),
      h.recipient_name ? 'to ' + h.recipient_name : null); });
  (d.vitals || []).forEach(function(v){
    push(v.measured_at, 'vit', String(v.parameter).toUpperCase() + ' ' + (+v.value) +
      (v.unit ? ' ' + v.unit : '')); });

  return rows.sort(function(a,b){ return new Date(a.at) - new Date(b.at); });
};

/* Totals are recomputed from the rows rather than stored, for the same reason
   the SQL view is derived: a cached total is a total that will eventually
   disagree with the entries it claims to summarise. */
ANES.totals = function(d){
  var sum = function(arr, f){ return arr.reduce(function(a,x){ return a + (+f(x) || 0); }, 0); };
  var m = d.milestones || {};
  var mins = function(a,b){ if(!m[a] || !m[b]) return null;
    return Math.round((new Date(m[b]) - new Date(m[a]))/60000); };
  var byCat = function(c){ return sum((d.fluids||[]).filter(function(f){ return f.category === c; }),
    function(f){ return f.volume_ml; }); };
  var out = {
    anesMin: mins('anesthesia_start','anesthesia_finish'),
    surgMin: mins('surgery_start','surgery_finish'),
    crystalloid: byCat('crystalloid'),
    colloid: byCat('colloid'),
    glucose: byCat('glucose'),
    bloodMl: sum(d.blood||[], function(b){ return b.volume_ml; }),
    bloodUnits: sum(d.blood||[], function(b){ return b.units; }),
    ebl: sum((d.outputs||[]).filter(function(o){ return o.kind === 'ebl'; }), function(o){ return o.volume_ml; }),
    urine: sum((d.outputs||[]).filter(function(o){ return o.kind === 'urine'; }), function(o){ return o.volume_ml; }),
    medications: (d.medications||[]).length,
    complications: (d.events||[]).filter(function(e){ return e.category === 'complication'; }).length
  };
  out.fluidsTotal = sum(d.fluids||[], function(f){ return f.volume_ml; });
  out.outputsTotal = sum(d.outputs||[], function(o){ return o.volume_ml; });
  out.balance = (out.fluidsTotal + out.bloodMl) - out.outputsTotal;
  return out;
};

/* A difficult airway must be impossible to miss once it is documented: it is
   the single fact from this chart most likely to matter to the next
   anesthetist who meets this patient. */
ANES.hasDifficultAirway = function(d){
  return (d.airway || []).some(function(a){ return ANES.yes(a.difficult_airway); })
      || ((d.preassessment || {}).anticipated_intubation_difficulty === 'likely');
};

/* The current ventilation is simply the most recent row. History stays
   visible, because how the settings got here is often the clinical story. */
ANES.currentVentilation = function(d){
  var v = (d.ventilation || []).slice().sort(function(a,b){
    return new Date(b.occurred_at) - new Date(a.occurred_at); });
  return v[0] || null;
};

window.ANES = ANES;
})();
