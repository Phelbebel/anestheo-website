/* anesthesia.js — the data layer for the Digital Anesthesia Record.
   Load order: CDN → supabase.js → auth.js → anesthesia.js → page script.

   Every write goes through here so there is one place that decides what a
   "medication administration" looks like, and one place to change when the
   schema grows. Nothing in this file is a security boundary: RLS decides who
   may read or write a case. What this file does is keep the client honest —
   it never sends entered_by for someone else, never invents a timestamp it
   did not observe, and never computes a dose. */
(function(){
'use strict';

var ANES = {};

/* ── Reference data ───────────────────────────────────────────────────────
   Favourites are the doses a clinician actually reaches for, so one tap
   records the common case. They are a starting point, never a prescription:
   the custom form is always one tab away and every entry stays editable. */
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
  { name:"Ringer's lactate", category:'crystalloid', volume_ml:500 },
  { name:'Normal saline 0.9%', category:'crystalloid', volume_ml:500 },
  { name:'Plasma-Lyte',      category:'crystalloid', volume_ml:500 },
  { name:'Albumin 5%',       category:'colloid',     volume_ml:250 }
];

ANES.EVENTS = ['hypotension','hypertension','bradycardia','tachycardia','desaturation',
  'difficult ventilation','bronchospasm','laryngospasm','difficult airway','aspiration',
  'anaphylaxis','major hemorrhage','arrhythmia','cardiac arrest','LAST','equipment failure'];

ANES.VITAL_UNITS = { hr:'bpm', sbp:'mmHg', dbp:'mmHg', map:'mmHg', spo2:'%',
  etco2:'mmHg', temp:'°C', bis:'', tof:'%', cvp:'mmHg', glucose:'mmol/L' };

/* ── Small helpers ────────────────────────────────────────────────────────
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
  var years = Math.floor(months/12);
  return years + 'y';
};
ANES.bmi = function(kg, cm){
  if(!kg || !cm) return null;
  var m = cm/100;
  return (kg/(m*m)).toFixed(1);
};
function nowIso(){ return new Date().toISOString(); }
async function uid(){ var s = await window.getSession(); return s ? s.user.id : null; }

/* ── Reads ────────────────────────────────────────────────────────────────
   One load, then everything is derived client-side. The queries are plain
   selects: RLS returns only the caller's cases, so there is no filtering to
   forget here. */
ANES.loadCase = async function(caseId){
  var out = { case:null, milestones:{}, medications:[], fluids:[], blood:[], outputs:[],
              events:[], vitals:[], regional:[], access:[], amendments:[], totals:null };
  if(!caseId) return out;
  try {
    var c = await window.sb.from('anesthesia_cases').select('*').eq('id', caseId).maybeSingle();
    if(c.error || !c.data) return out;
    out.case = c.data;

    var pull = async function(table, order){
      try {
        var r = await window.sb.from(table).select('*').eq('case_id', caseId).order(order, { ascending:true });
        return (r.error || !r.data) ? [] : r.data;
      } catch(e){ return []; }
    };
    var times = await pull('anesthesia_case_times','occurred_at');
    times.forEach(function(t){ out.milestones[t.milestone] = t.occurred_at; });
    out.times       = times;
    out.medications = await pull('anesthesia_medications','administered_at');
    out.fluids      = await pull('anesthesia_fluids','started_at');
    out.blood       = await pull('anesthesia_blood_products','started_at');
    out.outputs     = await pull('anesthesia_outputs','recorded_at');
    out.events      = await pull('anesthesia_events','occurred_at');
    out.vitals      = await pull('anesthesia_vitals','measured_at');
    out.regional    = await pull('anesthesia_regional','started_at');
    out.access      = await pull('anesthesia_access','inserted_at');
    out.amendments  = await pull('anesthesia_amendments','amended_at');
  } catch(e){ /* fall through with whatever loaded */ }
  return out;
};

ANES.listCases = async function(){
  try {
    var r = await window.sb.from('anesthesia_cases').select('*')
      .is('deleted_at', null).order('case_date', { ascending:false }).limit(100);
    return (r.error || !r.data) ? [] : r.data;
  } catch(e){ return []; }
};

/* ── Writes ───────────────────────────────────────────────────────────────
   entered_by is always the caller's own id. The RLS INSERT policies enforce
   entered_by = auth.uid(), so sending anything else would simply be refused —
   this just avoids constructing a payload the server is bound to reject. */
ANES.setMilestone = async function(caseId, milestone, when){
  var me = await uid();
  if(!me) return { error:{ message:'Not signed in' } };
  try {
    // A milestone is unique per case, so re-tapping corrects the time rather
    // than producing two contradictory entries.
    var r = await window.sb.from('anesthesia_case_times')
      .upsert({ case_id:caseId, milestone:milestone, occurred_at:when || nowIso(), entered_by:me },
              { onConflict:'case_id,milestone' });
    return { error: r.error || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

function writer(table, build){
  return async function(caseId, data){
    var me = await uid();
    if(!me) return { error:{ message:'Not signed in' } };
    try {
      var row = build(caseId, data, me);
      row.case_id = caseId; row.entered_by = me;
      var r = await window.sb.from(table).insert(row);
      return { error: r.error || null, data: r.data || null };
    } catch(e){ return { error:{ message:e.message } }; }
  };
}

ANES.addMedication = writer('anesthesia_medications', function(id, d){
  return { administered_at: d.administered_at || nowIso(), medication: d.medication,
           category: d.category || null, dose: d.dose, unit: d.unit,
           route: d.route || 'iv', line: d.line || null, indication: d.indication || null,
           is_redose: !!d.is_redose, note: d.note || null };
});
ANES.addFluid = writer('anesthesia_fluids', function(id, d){
  return { fluid: d.fluid, category: d.category || null, volume_ml: d.volume_ml,
           started_at: d.started_at || nowIso(), finished_at: d.finished_at || null,
           warmed: d.warmed == null ? null : !!d.warmed, note: d.note || null };
});
ANES.addBlood = writer('anesthesia_blood_products', function(id, d){
  return { product: d.product, units: d.units || null, volume_ml: d.volume_ml || null,
           unit_identifier: d.unit_identifier || null, started_at: d.started_at || nowIso(),
           reaction: d.reaction || null, note: d.note || null };
});
ANES.addOutput = writer('anesthesia_outputs', function(id, d){
  return { recorded_at: d.recorded_at || nowIso(), kind: d.kind,
           volume_ml: d.volume_ml, label: d.label || null, note: d.note || null };
});
ANES.addEvent = writer('anesthesia_events', function(id, d){
  return { occurred_at: d.occurred_at || nowIso(), category: d.category || 'complication',
           event_type: d.event_type, severity: d.severity || null,
           description: d.description || null, treatment: d.treatment || null,
           response: d.response || null, outcome: d.outcome || null };
});
ANES.addVital = writer('anesthesia_vitals', function(id, d){
  return { measured_at: d.measured_at || nowIso(), parameter: d.parameter,
           value: d.value, unit: d.unit || null,
           // 'manual' always: this project has no device integration, and a
           // record that claims a monitor produced a number a human typed is
           // a record that lies about its own provenance.
           source: 'manual' };
});
ANES.addAccess = writer('anesthesia_access', function(id, d){
  return { kind: d.kind, site: d.site || null, side: d.side || null, gauge: d.gauge || null,
           ultrasound: d.ultrasound == null ? null : !!d.ultrasound,
           attempts: d.attempts || null, inserted_at: d.inserted_at || nowIso(),
           complications: d.complications || null, note: d.note || null };
});

ANES.createCase = async function(data){
  var me = await uid();
  if(!me) return { error:{ message:'Not signed in' } };
  try {
    var row = {
      display_name: data.display_name || null, mrn: data.mrn || null,
      date_of_birth: data.date_of_birth || null, sex: data.sex || null,
      weight_kg: data.weight_kg || null, height_cm: data.height_cm || null,
      asa_class: data.asa_class || null, allergies: data.allergies || null,
      planned_procedure: data.planned_procedure || null, surgeon: data.surgeon || null,
      operating_room: data.operating_room || null,
      urgency: data.urgency || 'elective',
      anesthesia_types: data.anesthesia_types || [],
      case_modes: data.case_modes || [],
      status: 'in_progress',
      anesthesiologist_id: me, created_by: me
    };
    var r = await window.sb.from('anesthesia_cases').insert(row).select('id').maybeSingle();
    if(r.error) return { error:r.error };
    return { error:null, id: r.data ? r.data.id : null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* Lifecycle goes through the RPCs, never a direct UPDATE: they are the only
   things that can write finalized_by/finalized_at and guarantee the audit row. */
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

/* ── Derived views ────────────────────────────────────────────────────────
   The timeline merges every source into one chronological list, because that
   is how the case actually happened and how a reader reconstructs it. */
ANES.buildTimeline = function(d){
  var rows = [];
  var label = {};
  ANES.MILESTONES.forEach(function(m){ label[m.key] = m.label; });

  (d.times || []).forEach(function(t){
    rows.push({ at:t.occurred_at, cls:'milestone', text: label[t.milestone] || t.milestone,
                meta: t.note || null });
  });
  (d.medications || []).forEach(function(m){
    rows.push({ at:m.administered_at, cls:'', text: m.medication + ' ' + (+m.dose) + ' ' + m.unit +
                (m.route ? ' ' + m.route.toUpperCase() : ''), meta: m.is_redose ? 'redose' : null });
  });
  (d.fluids || []).forEach(function(f){
    rows.push({ at:f.started_at, cls:'', text: f.fluid + ' ' + (+f.volume_ml) + ' mL' });
  });
  (d.blood || []).forEach(function(b){
    rows.push({ at:b.started_at, cls:'', text: b.product.toUpperCase() +
                (b.units ? ' ' + (+b.units) + ' unit(s)' : '') , meta: b.unit_identifier || null });
  });
  (d.outputs || []).forEach(function(o){
    rows.push({ at:o.recorded_at, cls:'', text: o.kind.toUpperCase() + ' ' + (+o.volume_ml) + ' mL' });
  });
  (d.regional || []).forEach(function(r){
    rows.push({ at:r.started_at, cls:'', text: (r.block_name || r.kind) +
                (r.side ? ' (' + r.side + ')' : '') + ' block', meta: r.local_anesthetic || null });
  });
  (d.access || []).forEach(function(a){
    rows.push({ at:a.inserted_at, cls:'', text: (a.gauge ? a.gauge + ' ' : '') +
                a.kind.replace(/_/g,' ') + (a.site ? ' — ' + a.site : '') });
  });
  (d.events || []).forEach(function(e){
    rows.push({ at:e.occurred_at, cls:'ev', text: e.event_type,
                meta: [e.description, e.treatment].filter(Boolean).join(' · ') || null });
  });
  (d.vitals || []).forEach(function(v){
    rows.push({ at:v.measured_at, cls:'', text: v.parameter.toUpperCase() + ' ' + (+v.value) +
                (v.unit ? ' ' + v.unit : '') });
  });

  return rows.filter(function(r){ return r.at; })
             .sort(function(a,b){ return new Date(a.at) - new Date(b.at); });
};

/* Totals are recomputed from the rows rather than stored, for the same reason
   the SQL view is derived: a cached total is a total that will eventually
   disagree with the entries it claims to summarise. */
ANES.renderTotals = function(d){
  var sum = function(arr, f){ return arr.reduce(function(a,x){ return a + (+f(x) || 0); }, 0); };
  var m = d.milestones || {};
  var mins = function(a,b){ if(!m[a] || !m[b]) return null;
    return Math.round((new Date(m[b]) - new Date(m[a]))/60000); };
  var crystal = sum((d.fluids||[]).filter(function(f){ return f.category !== 'colloid'; }), function(f){ return f.volume_ml; });
  var colloid = sum((d.fluids||[]).filter(function(f){ return f.category === 'colloid'; }), function(f){ return f.volume_ml; });
  var ebl     = sum((d.outputs||[]).filter(function(o){ return o.kind === 'ebl'; }), function(o){ return o.volume_ml; });
  var urine   = sum((d.outputs||[]).filter(function(o){ return o.kind === 'urine'; }), function(o){ return o.volume_ml; });
  var blood   = sum(d.blood||[], function(b){ return b.volume_ml; });

  var anesMin = mins('anesthesia_start','anesthesia_finish');
  var surgMin = mins('surgery_start','surgery_finish');
  var fmt = function(v){ return v == null ? '—' : v; };
  var dur = function(v){ return v == null ? '—' : Math.floor(v/60) + 'h ' + (v%60) + 'm'; };

  var items = [
    ['Anesthesia time', dur(anesMin)],
    ['Surgical time',   dur(surgMin)],
    ['Crystalloid',     crystal ? crystal + ' mL' : '—'],
    ['Colloid',         colloid ? colloid + ' mL' : '—'],
    ['Blood products',  blood ? blood + ' mL' : '—'],
    ['Estimated blood loss', ebl ? ebl + ' mL' : '—'],
    ['Urine output',    urine ? urine + ' mL' : '—'],
    ['Balance',         (crystal+colloid+blood) || ebl || urine
                          ? ((crystal+colloid+blood) - ebl - urine) + ' mL' : '—'],
    ['Medications',     fmt((d.medications||[]).length)],
    ['Complications',   fmt((d.events||[]).filter(function(e){ return e.category==='complication'; }).length)]
  ];
  return items.map(function(i){
    return '<dt>' + i[0] + '</dt><dd>' + i[1] + '</dd>'; }).join('');
};

/* ── Quick panel definitions ─────────────────────────────────────────────── */
function esc(s){ return String(s == null ? '' : s)
  .replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

ANES.PANELS = [
  { id:'timeline', label:'Timeline', render:function(){
      return '<div class="qgrid">' + ANES.MILESTONES.map(function(m){
        return '<button class="qbtn" data-milestone="' + m.key + '" onclick="markMilestone(\'' +
               m.key + '\')"><b>' + esc(m.label) + '</b><small>stamps now</small></button>';
      }).join('') + '</div>';
    }},
  { id:'drugs', label:'Drugs', render:function(){
      return '<div class="qgrid">' + ANES.FAVOURITES.map(function(f){
        return '<button class="qbtn" onclick="giveDrug(\'' + f.name + '\',' + f.dose + ',\'' +
               f.unit + '\',\'' + f.cat + '\')"><b>' + esc(f.name) + '</b><small>' +
               f.dose + ' ' + f.unit + '</small></button>';
      }).join('') + '</div>' +
      '<label for="d-name">Something else</label>' +
      '<input id="d-name" placeholder="Medication">' +
      '<div class="fieldrow" style="grid-template-columns:1fr 90px 90px">' +
        '<input id="d-dose" type="number" step="any" placeholder="Dose">' +
        '<select id="d-unit"><option>mg</option><option>mcg</option><option>g</option>' +
          '<option>units</option><option>mL</option><option>mmol</option></select>' +
        '<select id="d-route"><option value="iv">IV</option><option value="im">IM</option>' +
          '<option value="po">PO</option><option value="sc">SC</option>' +
          '<option value="neuraxial">Neuraxial</option><option value="inhaled">Inh</option></select>' +
      '</div>' +
      '<button class="btn" onclick="giveCustomDrug()">Record administration</button>';
    }},
  { id:'fluids', label:'Fluids', render:function(){
      /* Rendered from FLUID_FAVOURITES by index rather than by interpolating
         the name into the handler: "Ringer's lactate" contains an apostrophe,
         and building JS by string-concatenating clinical names is how a button
         silently stops working. The index carries no quotes. */
      return '<div class="qgrid">' + ANES.FLUID_FAVOURITES.map(function(f, i){
        return '<button class="qbtn" onclick="addFluidFav(' + i + ')"><b>' + esc(f.name) +
               '</b><small>' + f.volume_ml + ' mL</small></button>';
      }).join('') + '</div>' +
      '<label>Other fluid</label><input id="f-name" placeholder="Fluid">' +
      '<div class="fieldrow"><input id="f-vol" type="number" placeholder="Volume mL">' +
      '<button class="qbtn" style="min-width:90px" onclick="addFluid(null,null,null)">Add</button></div>' +
      '<label>Losses and output</label>' +
      '<input id="o-vol" type="number" placeholder="Volume mL">' +
      '<div class="qgrid" style="margin-top:7px">' +
        '<button class="qbtn" onclick="addOutput(\'ebl\')"><b>Blood loss</b></button>' +
        '<button class="qbtn" onclick="addOutput(\'urine\')"><b>Urine</b></button>' +
      '</div>';
    }},
  { id:'vitals', label:'Vitals', render:function(){
      return '<div class="fieldrow" style="grid-template-columns:1fr 1fr">' +
        '<select id="v-param">' + Object.keys(ANES.VITAL_UNITS).map(function(k){
          return '<option value="' + k + '">' + k.toUpperCase() + '</option>'; }).join('') + '</select>' +
        '<input id="v-value" type="number" step="any" placeholder="Value">' +
        '</div>' +
        '<button class="btn" onclick="addVital()">Record measurement</button>' +
        '<div style="font-size:11.5px;color:rgba(255,255,255,.32);margin-top:9px;line-height:1.6">' +
        'Entered by hand and stored as manual. Anestheo has no monitor integration, ' +
        'and the record will never claim a device produced a number a person typed.</div>';
    }},
  { id:'events', label:'Events', render:function(){
      return '<input id="e-desc" placeholder="Description (optional)">' +
        '<div class="qgrid" style="margin-top:9px">' + ANES.EVENTS.map(function(e){
          return '<button class="qbtn" onclick="addEvent(\'' + e + '\')"><b>' + esc(e) + '</b></button>';
        }).join('') + '</div>';
    }}
];

window.ANES = ANES;
})();
